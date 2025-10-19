package server

import (
	"cmp"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"

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
	Characters []schema.Character `json:"characters"`
	Timeline   []schema.Timeline  `json:"timeline"`
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
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		return c.JSON(http.StatusOK, NameInferResponse{Characters: nil})
	}

	chunks := utils.ChunkText(req.Text, 8192*4)
	ctx := c.Request().Context()

	var accum []Character
	for _, ch := range chunks {
		infer, err := s.Inferencer.Infer(ctx, nil, nameExtractPrompt, ch)
		if err != nil {
			accum = mergeNameCharacters(accum, heuristicCharsFromText(ch))
			continue
		}

		var part NameInferResponse
		if err := json.Unmarshal([]byte(infer), &part); err != nil || len(part.Characters) == 0 {
			utils.Logf("name extraction parse error or empty result, falling back to heuristic: %v", err)
			accum = mergeNameCharacters(accum, heuristicCharsFromText(ch))
			continue
		}
		accum = mergeNameCharacters(accum, part.Characters)
	}

	return c.JSON(http.StatusOK, NameInferResponse{Characters: accum})
}

// Merge Characters by name (case-insensitive), union aliases (unique, trimmed).
func mergeNameCharacters(base, updates []Character) []Character {
	by := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

	// index existing by name
	idx := make(map[string]int, len(base))
	for i, ch := range base {
		k := by(ch.Name)
		if k != "" {
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
			// merge aliases into base[i]
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
			// normalize aliases on insert
			seen := map[string]struct{}{}
			ali := make([]string, 0, len(up.Aliases))
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

// Use your conservative heuristic on the original text, adapt to []Character.
func heuristicCharsFromText(text string) []Character {
	var out []Character
	for _, ec := range detectNamesHeuristically(text) {
		n := strings.TrimSpace(ec.Name)
		if n != "" {
			out = append(out, Character{Name: n})
		}
	}
	return out
}

type summarizeModelResp struct {
	Characters []schema.Character `json:"characters"`
}

// POST /api/summarize
func (s *Server) handlePostSummarize(c echo.Context) error {
	var req summarizeReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	req.Text = strings.TrimSpace(req.Text)
	if len(req.Characters) == 0 && len(s.Characters) > 0 {
		req.Characters = s.Characters
	}
	seed := dedupeByName(req.Characters)

	if req.Text == "" {
		return c.JSON(http.StatusOK, schema.Summary{Characters: seed})
	}

	chunks := utils.ChunkText(req.Text, 8192*4)
	ctx := c.Request().Context()
	accum := req.Characters

	w := utils.NewSSEWriter(c)
	defer w.Close()

	systemPrompt := summarizePrompt
	for i, char := range s.Characters {
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
		if i == len(s.Characters)-1 {
			c.Logger().Warnf("no example character available for summarization prompt")
		}
	}

	for i, chunk := range chunks {
		if cancelled(c) {
			break
		}

		if len(accum) > 0 {
			bin, err := json.MarshalIndent(schema.Summary{Characters: accum}, "", " ")
			if err != nil {
				return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed preparing summarization context"))
			}
			chunk += "\n\nIterate on the following JSON, only changing details if mentioned or explicitly stated:\n" + string(bin)
		}

		if cancelled(c) {
			break
		}

		totalTokens := int64(len(systemPrompt) + len(chunk))
		params := &openai.ChatCompletionNewParams{
			MaxCompletionTokens: openai.Int(totalTokens * 2),
			ResponseFormat:      schema.StructuredOutputsResponseFormat(),
		}
		c.Logger().Debugf("summarizing chunk %d/%d (%d chars)", i+1, len(chunks), totalTokens)
		out, err := s.Inferencer.Infer(ctx, params, systemPrompt, chunk)
		if err != nil {
			c.Logger().Errorf("summarization inference error on chunk %d: %v", i+1, err)
			_ = w.Event("error", map[string]string{"chunk": strconv.Itoa(i + 1), "error": err.Error()})
			break
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
			c.Logger().Errorf("summarization empty result on chunk %d", i+1)
			continue
		}
		if out[0] != '{' {
			if j := strings.Index(out, "{"); j != -1 {
				out = out[j:]
			} else {
				c.Logger().Errorf("summarization no JSON result on chunk %d", i+1)
				c.Logger().Debugf("model output:\n```\n%s\n```", out)
				continue
			}
		}
		if out[len(out)-1] != '}' {
			if j := strings.LastIndex(out, "}"); j != -1 {
				out = out[:j+1]
			} else {
				c.Logger().Errorf("summarization no JSON result on chunk %d", i+1)
				c.Logger().Debugf("model output:\n```\n%s\n```", out)
				continue
			}
		}

		var parsed summarizeModelResp
		if err := json.Unmarshal([]byte(out), &parsed); err != nil || len(parsed.Characters) == 0 {
			c.Logger().Errorf("summarization parse error or empty result on chunk %d: %v", i+1, err)
			c.Logger().Debugf("model output:\n```\n%s\n```", out)
			continue
		}

		accum = mergeCharacters(accum, dedupeByName(parsed.Characters))
		if err := w.Event("data", schema.Summary{Characters: accum}); err != nil {
			c.Logger().Errorf("SSE write error: %v", err)
			return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed sending summarization progress"))
		}
	}

	if cancelled(c) {
		return nil
	}

	if len(accum) == 0 && len(seed) == 0 {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed parsing summarization result"))
	}

	s.Characters = accum
	_ = w.Event("done", schema.Summary{Characters: mergeCharacters(seed, accum)})

	return nil
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

// --- helpers ---

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
	a.Age = cmp.Or(a.Age, b.Age)
	a.Gender = cmp.Or(a.Gender, b.Gender)
	a.Role = cmp.Or(a.Role, b.Role)
	a.Personality = cmp.Or(a.Personality, b.Personality)

	a.PhysicalDescription.Height = cmp.Or(a.PhysicalDescription.Height, b.PhysicalDescription.Height)
	a.PhysicalDescription.Build = cmp.Or(a.PhysicalDescription.Build, b.PhysicalDescription.Build)
	a.PhysicalDescription.Hair = cmp.Or(a.PhysicalDescription.Hair, b.PhysicalDescription.Hair)
	a.PhysicalDescription.Other = cmp.Or(a.PhysicalDescription.Other, b.PhysicalDescription.Other)

	a.SexualCharacteristics.Genitalia = cmp.Or(a.SexualCharacteristics.Genitalia, b.SexualCharacteristics.Genitalia)
	a.SexualCharacteristics.PenisLengthFlaccid = cmp.Or(a.SexualCharacteristics.PenisLengthFlaccid, b.SexualCharacteristics.PenisLengthFlaccid)
	a.SexualCharacteristics.PenisLengthErect = cmp.Or(a.SexualCharacteristics.PenisLengthErect, b.SexualCharacteristics.PenisLengthErect)
	a.SexualCharacteristics.PubicHair = cmp.Or(a.SexualCharacteristics.PubicHair, b.SexualCharacteristics.PubicHair)
	a.SexualCharacteristics.Other = cmp.Or(a.SexualCharacteristics.Other, b.SexualCharacteristics.Other)

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
				if sim := utils.Similarity(existing, nb); sim >= 0.7 {
					// Prefer the longer one
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
