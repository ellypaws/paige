package server

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"maps"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/labstack/echo/v4"
	"github.com/openai/openai-go/v3"

	"paige/pkg/schema"
	"paige/pkg/utils"
)

type namesReq struct {
	Text string `json:"text"`
}
type summarizeReq struct {
	Text       string             `json:"text"`
	ID         string             `json:"id,omitempty"`
	Source     string             `json:"source,omitempty"`
	Chapter    string             `json:"chapter,omitempty"`
	Characters []schema.Character `json:"characters"`
	Timeline   []schema.Timeline  `json:"timeline"`
	Paragraphs map[string]string  `json:"paragraphs,omitempty"`
}

type NameInferResponse struct {
	Characters []Character `json:"characters"`
}

type Character struct {
	Name    string   `json:"name"`
	Aliases []string `json:"aliases"`
}

// POST /api/names
func (s *Server) handlePostNames(c echo.Context) error {
	var req namesReq
	if err := c.Bind(&req); err != nil {
		log.Warn("invalid JSON in /api/names", "error", err)
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		log.Warn("empty text received for /api/names")
		return c.JSON(http.StatusOK, NameInferResponse{Characters: nil})
	}

	chunks := utils.ChunkText(req.Text, 8192*4)
	ctx := c.Request().Context()
	log.Info("processing /api/names", "chunks", len(chunks))

	var accum []Character
	for i, ch := range chunks {
		log.Debug("inferring name chunk", "index", i+1, "length", len(ch))
		infer, err := s.Inferencer.Infer(ctx, nil, nameExtractPrompt, ch)
		if err != nil {
			log.Warn("inference error on name chunk, falling back to heuristic", "index", i+1, "error", err)
			accum = mergeNameCharacters(accum, heuristicCharsFromText(ch))
			continue
		}

		var part NameInferResponse
		if err := json.Unmarshal([]byte(infer), &part); err != nil || len(part.Characters) == 0 {
			log.Warn("name extraction parse error or empty result, using heuristic", "index", i+1, "error", err)
			accum = mergeNameCharacters(accum, heuristicCharsFromText(ch))
			continue
		}
		accum = mergeNameCharacters(accum, part.Characters)
	}

	log.Info("completed name extraction", "count", len(accum))
	return c.JSON(http.StatusOK, NameInferResponse{Characters: accum})
}

// Merge Characters by name (case-insensitive), union aliases (unique, trimmed).
func mergeNameCharacters(base, updates []Character) []Character {
	by := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

	idx := make(map[string]int, len(base))
	for i, ch := range base {
		if k := by(ch.Name); k != "" {
			idx[k] = i
		}
	}

	for _, up := range updates {
		name := strings.TrimSpace(up.Name)
		if name == "" {
			continue
		}
		k := by(name)
		if i, ok := idx[k]; ok {
			seen := make(map[string]struct{}, len(base[i].Aliases))
			for _, a := range base[i].Aliases {
				a = strings.TrimSpace(a)
				if a != "" {
					seen[a] = struct{}{}
				}
			}
			for _, a := range up.Aliases {
				a = strings.TrimSpace(a)
				if a == "" || strings.EqualFold(a, name) {
					continue
				}
				if _, ok := seen[a]; ok {
					continue
				}
				seen[a] = struct{}{}
				base[i].Aliases = append(base[i].Aliases, a)
			}
		} else {
			seen := map[string]struct{}{}
			var ali []string
			for _, a := range up.Aliases {
				a = strings.TrimSpace(a)
				if a == "" || strings.EqualFold(a, name) {
					continue
				}
				if _, ok := seen[a]; ok {
					continue
				}
				seen[a] = struct{}{}
				ali = append(ali, a)
			}
			base = append(base, Character{Name: name, Aliases: ali})
			idx[k] = len(base) - 1
		}
	}
	return base
}

func heuristicCharsFromText(text string) []Character {
	log.Debug("using heuristic name detection", "length", len(text))
	var out []Character
	for _, ec := range detectNamesHeuristically(text) {
		n := strings.TrimSpace(ec.Name)
		if n != "" {
			out = append(out, Character{Name: n})
		}
	}
	log.Debug("heuristic name detection completed", "count", len(out))
	return out
}

// POST /api/summarize
func (s *Server) handlePostSummarize(c echo.Context) error {
	var req summarizeReq
	if err := c.Bind(&req); err != nil {
		log.Error("invalid JSON in /api/summarize", "error", err)
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Source != "" && req.ID != "" {
		req.ID = req.Source + ":" + req.ID
	}
	log.Info("starting summarization", "id", req.ID, "chars", len(req.Text), "paragraphs", len(req.Paragraphs))
	w := utils.NewSSEWriter(c)
	defer w.Close()

	summary := schema.Summary{
		Characters: req.Characters,
		Timeline:   req.Timeline,
	}
	if existing, ok := s.Summary[req.ID]; ok {
		summary = existing
		summary.Heat = nil
		if heat, ok := summary.StoredHeat[req.Chapter]; ok && len(heat) > 0 {
			summary.Heat = summary.StoredHeat[req.Chapter]
		}
	}

	hasCharacters := len(summary.Characters) > 0
	isAO3 := req.Source == "ao3" && summary.Chapters[req.Chapter]
	isInkbunny := req.Source == "inkbunny"
	hasHeat := len(summary.Heat) > 0
	cacheControl := c.Request().Header.Get("Cache-Control") != "no-cache"

	if cacheControl && hasCharacters && hasHeat && (isAO3 || isInkbunny) {
		log.Info("loaded existing summary data", "id", req.ID, "characters", len(summary.Characters), "timeline", len(summary.Timeline), "chapters", len(summary.Chapters))
		return w.Event("done", summary)
	}

	if req.Source == "ao3" && req.Chapter != "" && summary.Chapters == nil {
		summary.Chapters = make(map[string]bool)
	}

	seed := dedupeByName(req.Characters)

	if len(req.Paragraphs) == 0 && req.Text == "" {
		log.Warn("empty text in summarization, returning existing data")
		return w.Event("done", schema.Summary{Characters: seed, Timeline: req.Timeline, Chapters: summary.Chapters})
	}

	ctx := c.Request().Context()

	systemPrompt := summarizePrompt
	for i, char := range req.Characters {
		if strings.Contains(systemPrompt, "Example") {
			break
		}
		if strings.EqualFold(char.Role, "main") {
			bin, _ := json.MarshalIndent(char, "", " ")
			if len(bin) > 0 {
				systemPrompt = summarizePrompt + "\nExample:\n```\n" + string(bin) + "\n```\n"
				break
			}
		}
		if i == len(s.Summary)-1 {
			log.Warn("no example character available for summarization prompt")
		}
	}

	for i, chunk := range chunkRequest(req, 8192*4) {
		if cancelled(c) {
			log.Warn("summarization cancelled by client", "index", i)
			break
		}

		id := fmt.Sprintf("%s:%s chapter:%s chunk:%d", req.Source, req.ID, req.Chapter, i)
		if _, ok := s.Forbids[id]; ok {
			continue
		}

		var wg sync.WaitGroup
		var forbidden *schema.Forbids
		for _, forbid := range s.Forbids {
			wg.Go(func() {
				if utils.Similarity(forbid.Text, chunk) >= 0.8 {
					forbidden = &forbid
				}
			})
		}
		wg.Wait()
		if forbidden != nil {
			compressed, _ := utils.CompressToBase64(chunk)
			forbidden.Compressed = compressed
			s.Forbids[id] = schema.Forbids{
				Reason:     "similar to forbidden content",
				Text:       chunk,
				Compressed: compressed,
				Error:      forbidden.Error,
				Raw:        forbidden.Raw,
			}
			continue
		}

		if len(summary.Characters) > 0 || len(summary.Timeline) > 0 {
			bin, err := json.MarshalIndent(schema.Summary{Characters: summary.Characters, Timeline: summary.Timeline}, "", " ")
			if err != nil {
				log.Warn("failed preparing summarization context", "error", err)
				return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed preparing summarization context"))
			}
			chunk += "\n\nIterate on the following JSON, only changing details if mentioned or explicitly stated:\n" + string(bin)
		}

		totalCharacters := int64(len(systemPrompt) + len(chunk))
		tokenCount, err := utils.NumTokensFromMessages(systemPrompt + chunk)
		if err != nil {
			log.Debug("summarizing chunk", "chunk", i+1, "chars", totalCharacters)
		} else {
			log.Debug("summarizing chunk", "chunk", i+1, "chars", totalCharacters, "tokens", tokenCount, "ratio", float64(totalCharacters)/float64(tokenCount))
		}

		params := &openai.ChatCompletionNewParams{
			MaxCompletionTokens: openai.Int(max(int64(tokenCount), totalCharacters, 8192*4) * 2),
			ResponseFormat:      schema.StructuredOutputsResponseFormat(),
		}

		if cancelled(c) {
			break
		}

		out, err := s.Inferencer.Infer(ctx, params, systemPrompt, chunk)
		if err != nil {
			var apiErr *openai.Error
			if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusForbidden {
				log.Error("summarization forbidden", "chunk", i+1, "error", err)
				if s.Forbids == nil {
					s.Forbids = make(map[string]schema.Forbids)
				}
				compressed, _ := utils.CompressToBase64(chunk)
				s.Forbids[id] = schema.Forbids{
					Reason:     "summarization forbidden",
					Text:       chunk,
					Compressed: compressed,
					Raw:        apiErr.RawJSON(),
				}
				_ = w.Event("error", map[string]string{
					"chunk": strconv.Itoa(i + 1),
					"error": apiErr.Error(),
					"text":  chunk,
				})
				if err := utils.Save("Forbids.json", s.Forbids); err != nil {
					log.Warn("failed saving forbids data", "error", err)
				}
				continue
			} else {
				log.Warn("summarization inference error", "chunk", i+1, "error", err)
				_ = w.Event("error", map[string]string{"chunk": strconv.Itoa(i + 1), "error": err.Error(), "text": chunk})
				break
			}
		}

		if cancelled(c) {
			break
		}

		if strings.Contains(out, "<think>") {
			if idx := strings.LastIndex(out, "</think>"); idx != -1 {
				out = out[idx+len("</think>"):]
			}
		}

		if len(out) == 0 {
			log.Warn("summarization returned empty output", "chunk", i+1)
			continue
		}
		if out[0] != '{' {
			if j := strings.Index(out, "{"); j != -1 {
				out = out[j:]
			} else {
				log.Warn("no JSON start found in summarization output", "chunk", i+1)
				log.Debug("raw output", "output", out)
				continue
			}
		}
		if out[len(out)-1] != '}' {
			if j := strings.LastIndex(out, "}"); j != -1 {
				out = out[:j+1]
			} else {
				log.Warn("no JSON end found in summarization output", "chunk", i+1)
				log.Debug("raw output", "output", out)
				continue
			}
		}

		var parsed schema.Summary
		if err := json.Unmarshal([]byte(out), &parsed); err != nil || len(parsed.Characters) == 0 {
			log.Warn("failed to parse summarization JSON, attempting to fix", "chunk", i+1, "error", err)
			log.Debug("original model output", "output", out)

			fixedOut, fixErr := s.Inferencer.Infer(ctx, params, systemPrompt+"\n\n"+fixJSONPrompt, chunk+"\n\nFix and complete the following malformed JSON:\n\n"+out)
			if fixErr != nil {
				log.Warn("failed to fix inference", "chunk", i+1, "error", fixErr)
				continue
			}

			if err := json.Unmarshal([]byte(fixedOut), &parsed); err != nil || len(parsed.Characters) == 0 {
				log.Warn("failed to parse summarization JSON after fix attempt", "chunk", i+1, "error", err)
				log.Debug("fixed model output", "output", fixedOut)
				continue
			}
		}

		log.Debug("merging summarization results", "chunk", i+1, "chars", len(parsed.Characters), "events", len(parsed.Timeline))
		summary.Characters = mergeCharacters(summary.Characters, dedupeByName(parsed.Characters))
		summary.Timeline = mergeTimelines(summary.Timeline, parsed.Timeline)
		if summary.Heat != nil {
			maps.Copy(summary.Heat, parsed.Heat)
		} else {
			summary.Heat = parsed.Heat
		}
		if summary.StoredHeat == nil {
			summary.StoredHeat = make(map[string]map[string]int)
		}
		summary.StoredHeat[req.Chapter] = summary.Heat

		if err := w.Event("data", summary); err != nil {
			log.Warn("SSE write error", "error", err)
			return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed sending summarization progress"))
		}
	}

	if cancelled(c) {
		log.Warn("summarization aborted after client disconnect")
		return nil
	}

	if len(summary.Characters) == 0 && len(seed) == 0 {
		log.Warn("no summary data extracted")
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed parsing summarization result"))
	}

	if req.Chapter != "" {
		if summary.Chapters == nil {
			summary.Chapters = make(map[string]bool)
		}
		summary.Chapters[req.Chapter] = true
	}

	s.Summary[req.ID] = summary
	if err := utils.Save("CharacterSummary.json", s.Summary); err != nil {
		log.Warn("failed saving summary data", "error", err)
	}
	log.Info("summarization complete", "id", req.ID, "characters", len(summary.Characters), "timeline", len(summary.Timeline))

	return w.Event("done", summary)
}

func chunkRequest(req summarizeReq, limit int) iter.Seq2[int, string] {
	return func(yield func(int, string) bool) {
		if len(req.Paragraphs) > 0 {
			for i, chunk := range utils.ChunkParagraph(req.Paragraphs, limit) {
				if len(chunk) == 0 {
					return
				}
				var sb strings.Builder
				sb.WriteByte('{')
				for j, paragraph := range chunk {
					if j > 0 {
						sb.WriteByte(',')
					}
					sb.WriteString(strconv.Quote(strconv.Itoa(paragraph.Index)))
					sb.WriteByte(':')
					sb.WriteString(strconv.Quote(paragraph.Text))
				}
				sb.WriteByte('}')

				if !yield(i, sb.String()) {
					return
				}
			}
		} else if len(req.Text) > 0 {
			for i, chunk := range utils.ChunkText(req.Text, limit) {
				if !yield(i, chunk) {
					return
				}
			}
		}
	}
}

func cancelled(c echo.Context) bool {
	select {
	case <-c.Request().Context().Done():
		return true
	default:
		return false
	}
}

// GET /userscript (optional dev helper)
func (s *Server) handleGetUserscript(c echo.Context) error {
	// Serve the local userscript during dev; cache-disabled for easy refresh.
	f, err := os.Open("paige.userscript.js")
	if err != nil {
		// If project layout differs, try current working directory as fallback.
		// You can hardcode absolute path if you prefer.
		return echo.NewHTTPError(http.StatusNotFound, "userscript not found")
	}
	defer f.Close()

	b, err := io.ReadAll(f)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed reading userscript")
	}
	return c.Blob(http.StatusOK, "text/javascript; charset=utf-8", b)
}

func dedupeByName(in []schema.Character) []schema.Character {
	seen := make(map[string]struct{}, len(in))
	out := make([]schema.Character, 0, len(in))
	for _, ch := range in {
		n := strings.TrimSpace(ch.Name)
		if n == "" {
			continue
		}
		key := strings.ToLower(n)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		ch.Name = n
		out = append(out, ch)
	}
	return out
}

var wordRX = regexp.MustCompile(`\b[[:upper:]][[:lower:]]+(?:\s+[[:upper:]][[:lower:]]+){0,2}\b`)

// extremely conservative local fallback detector
func detectNamesHeuristically(text string) []schema.Character {
	counts := map[string]int{}
	for _, m := range wordRX.FindAllString(text, -1) {
		if len(m) < 3 {
			continue
		}
		// Ignore sentence starts common words (quick filter)
		if common := strings.ToLower(m); common == "the" || common == "And" {
			continue
		}
		counts[m]++
	}
	// keep those seen at least twice
	type kv struct {
		k string
		v int
	}
	var arr []kv
	for k, v := range counts {
		if v >= 2 {
			arr = append(arr, kv{k, v})
		}
	}
	slices.SortFunc(arr, func(a, b kv) int { return b.v - a.v })
	out := make([]schema.Character, 0, len(arr))
	for _, it := range arr {
		out = append(out, schema.Character{Name: it.k})
	}
	return out
}

func mergeCharacters(base, updates []schema.Character) []schema.Character {
	byName := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	dst := make(map[string]schema.Character, len(base))
	order := make([]string, 0, len(base))

	for _, ch := range base {
		k := byName(ch.Name)
		if k == "" {
			continue
		}
		dst[k] = ch
		order = append(order, k)
	}

	for _, up := range updates {
		k := byName(up.Name)
		if k == "" {
			continue
		}
		if cur, ok := dst[k]; ok {
			dst[k] = mergeOne(cur, up)
		} else {
			dst[k] = up
			order = append(order, k)
		}
	}

	out := make([]schema.Character, 0, len(dst))
	for _, k := range order {
		out = append(out, dst[k])
	}
	return out
}

func mergeOne(a, b schema.Character) schema.Character {
	a.Age = cmp.Or(b.Age, a.Age)
	a.Gender = cmp.Or(b.Gender, a.Gender)
	a.Kind = cmp.Or(b.Kind, a.Kind)
	a.Role = cmp.Or(b.Role, a.Role)
	a.Species = cmp.Or(b.Species, a.Species)
	a.Personality = cmp.Or(b.Personality, a.Personality)

	// Merge aliases uniquely (case-insensitive)
	if len(b.Aliases) > 0 {
		seen := make(map[string]struct{}, len(a.Aliases))
		for _, s := range a.Aliases {
			if s = strings.TrimSpace(s); s != "" {
				seen[strings.ToLower(s)] = struct{}{}
			}
		}
		for _, s := range b.Aliases {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			key := strings.ToLower(s)
			if _, ok := seen[key]; !ok {
				a.Aliases = append(a.Aliases, s)
				seen[key] = struct{}{}
			}
		}
	}

	a.PhysicalDescription.Height = cmp.Or(b.PhysicalDescription.Height, a.PhysicalDescription.Height)
	a.PhysicalDescription.Build = cmp.Or(b.PhysicalDescription.Build, a.PhysicalDescription.Build)
	a.PhysicalDescription.Hair = cmp.Or(b.PhysicalDescription.Hair, a.PhysicalDescription.Hair)
	a.PhysicalDescription.Other = cmp.Or(b.PhysicalDescription.Other, a.PhysicalDescription.Other)

	a.SexualCharacteristics.Genitalia = cmp.Or(b.SexualCharacteristics.Genitalia, a.SexualCharacteristics.Genitalia)
	a.SexualCharacteristics.PenisLengthFlaccid = cmp.Or(b.SexualCharacteristics.PenisLengthFlaccid, a.SexualCharacteristics.PenisLengthFlaccid)
	a.SexualCharacteristics.PenisLengthErect = cmp.Or(b.SexualCharacteristics.PenisLengthErect, a.SexualCharacteristics.PenisLengthErect)
	a.SexualCharacteristics.PubicHair = cmp.Or(b.SexualCharacteristics.PubicHair, a.SexualCharacteristics.PubicHair)
	a.SexualCharacteristics.Other = cmp.Or(b.SexualCharacteristics.Other, a.SexualCharacteristics.Other)

	if len(b.NotableActions) > 0 {
		var out []string
		for _, s := range a.NotableActions {
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}

	NextAction:
		for _, nb := range b.NotableActions {
			nb = strings.TrimSpace(nb)
			if nb == "" {
				continue
			}

			for i, existing := range out {
				if sim := utils.Similarity(existing, nb); sim >= 0.70 {
					if len(nb) > len(existing) {
						out[i] = nb
					}
					continue NextAction
				}
			}
			out = append(out, nb)
		}
		a.NotableActions = out
	}

	return a
}

// mergeTimelines merges timeline slices with 70% similarity threshold
func mergeTimelines(base, updates []schema.Timeline) []schema.Timeline {
	dateMap := make(map[string][]schema.Event)
	for _, t := range base {
		dateMap[t.Date] = append(dateMap[t.Date], t.Events...)
	}

	for _, up := range updates {
		existing := dateMap[up.Date]
		for _, newEv := range up.Events {
			found := false
			for i, oldEv := range existing {
				// Compare similarity by description and time
				if utils.Similarity(oldEv.Description, newEv.Description) >= 0.70 ||
					utils.Similarity(oldEv.Time, newEv.Time) >= 0.70 {
					// Merge by preferring longer / newer details
					if len(newEv.Description) > len(oldEv.Description) {
						existing[i].Description = newEv.Description
					}
					if oldEv.Time == "" && newEv.Time != "" {
						existing[i].Time = newEv.Time
					}
					found = true
					break
				}
			}
			if !found {
				existing = append(existing, newEv)
			}
		}
		dateMap[up.Date] = existing
	}

	// convert map back to slice
	out := make([]schema.Timeline, 0, len(dateMap))
	for date, events := range dateMap {
		out = append(out, schema.Timeline{Date: date, Events: events})
	}
	slices.SortFunc(out, func(a, b schema.Timeline) int {
		return strings.Compare(a.Date, b.Date)
	})
	return out
}
