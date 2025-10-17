package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/labstack/echo/v4"

	"paige/pkg/entities"
	"paige/pkg/utils"
)

type namesReq struct {
	Text string `json:"text"`
}
type summarizeReq struct {
	Text       string               `json:"text"`
	Characters []entities.Character `json:"characters"`
}
type charactersResp struct {
	Characters []entities.Character `json:"characters"`
}

// --- optional narrow interfaces the Inferencer may provide ---

type characterDetector interface {
	// DetectCharacters returns a list of characters it sees in `text`.
	DetectCharacters(ctx context.Context, text string) ([]entities.Character, error)
}
type characterSummarizer interface {
	// SummarizeCharacters returns richer character details based on text + seeds.
	SummarizeCharacters(ctx context.Context, text string, seed []entities.Character) ([]entities.Character, error)
}

// --- handlers ---

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

	chunks := chunkText(req.Text, 2048)
	ctx := c.Request().Context()

	var accum []Character
	for _, ch := range chunks {
		infer, err := s.Inferencer.Infer(ctx, nameExtractPrompt, ch)
		if err != nil {
			// model failed for this chunk → heuristic fallback using the chunk itself
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
	Characters []entities.Character `json:"characters"`
}

// POST /api/summarize
func (s *Server) handlePostSummarize(c echo.Context) error {
	var req summarizeReq
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	req.Text = strings.TrimSpace(req.Text)
	seed := dedupeByName(req.Characters)

	if req.Text == "" {
		return c.JSON(http.StatusOK, charactersResp{Characters: seed})
	}

	chunks := chunkText(req.Text, 2048)
	ctx := c.Request().Context()

	var accum []entities.Character
	for _, ch := range chunks {
		out, err := s.Inferencer.Infer(ctx, summarizePrompt, ch)
		if err != nil {
			continue
		}
		var parsed summarizeModelResp
		if err := json.Unmarshal([]byte(out), &parsed); err != nil || len(parsed.Characters) == 0 {
			continue
		}
		accum = mergeCharacters(accum, dedupeByName(parsed.Characters))
	}

	if len(accum) == 0 && len(seed) == 0 {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON("failed parsing summarization result"))
	}

	return c.JSON(http.StatusOK, charactersResp{Characters: mergeCharacters(seed, accum)})
}

var paragraphRX = regexp.MustCompile(`\n{2,}`)

func chunkText(text string, limit int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if runeLen(text) <= limit {
		return []string{text}
	}

	// Decide primary block unit: paragraphs, else single lines, else whole text.
	var blocks []string
	var joiner string
	if paragraphRX.FindStringIndex(text) != nil {
		blocks = paragraphRX.Split(text, -1)
		joiner = "\n\n"
	} else if strings.Contains(text, "\n") {
		blocks = strings.Split(text, "\n")
		joiner = "\n"
	} else {
		blocks = []string{text}
		joiner = " "
	}

	out := make([]string, 0, len(blocks))
	cur := ""

	var appendPiece func(piece string)
	appendPiece = func(piece string) {
		piece = strings.TrimSpace(piece)
		if piece == "" {
			return
		}
		if cur == "" {
			if runeLen(piece) <= limit {
				cur = piece
				return
			}
			// piece itself too large: split by spaces safely
			for _, p := range splitBySpaceRune(piece, limit) {
				if cur == "" {
					cur = p
				} else if runeLen(cur)+runeLen(joiner)+runeLen(p) <= limit {
					cur = cur + joiner + p
				} else {
					out = append(out, cur)
					cur = p
				}
			}
			return
		}
		// Try to add with joiner
		if runeLen(cur)+runeLen(joiner)+runeLen(piece) <= limit {
			cur = cur + joiner + piece
			return
		}
		// Flush and handle piece
		out = append(out, cur)
		cur = ""
		appendPiece(piece)
	}

	for _, b := range blocks {
		b = strings.TrimSpace(b)
		if b == "" {
			continue
		}
		// If block fits, try to pack as-is; otherwise split by spaces.
		if runeLen(b) <= limit {
			appendPiece(b)
		} else {
			for _, p := range splitBySpaceRune(b, limit) {
				appendPiece(p)
			}
		}
	}

	if strings.TrimSpace(cur) != "" {
		out = append(out, cur)
	}
	return out
}

func splitBySpaceRune(s string, limit int) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if runeLen(s) <= limit {
		return []string{s}
	}
	var parts []string
	for s != "" {
		if runeLen(s) <= limit {
			parts = append(parts, s)
			break
		}
		idx := lastWhitespaceByteIndexBeforeRuneLimit(s, limit)
		if idx <= 0 {
			// No whitespace before limit; hard-cut at rune boundary
			cut := byteIndexAtRunePos(s, limit)
			parts = append(parts, strings.TrimSpace(s[:cut]))
			s = strings.TrimSpace(s[cut:])
			continue
		}
		parts = append(parts, strings.TrimSpace(s[:idx]))
		s = strings.TrimLeftFunc(s[idx:], unicode.IsSpace)
	}
	return parts
}

func lastWhitespaceByteIndexBeforeRuneLimit(s string, limit int) int {
	rc := 0
	last := -1
	for i, r := range s {
		if rc >= limit {
			break
		}
		if unicode.IsSpace(r) {
			last = i
		}
		rc++
	}
	return last
}

func byteIndexAtRunePos(s string, pos int) int {
	if pos <= 0 {
		return 0
	}
	i := 0
	for pos > 0 && i < len(s) {
		_, sz := utf8.DecodeRuneInString(s[i:])
		i += sz
		pos--
	}
	return i
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

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

func dedupeByName(in []entities.Character) []entities.Character {
	seen := make(map[string]struct{}, len(in))
	out := make([]entities.Character, 0, len(in))
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
func detectNamesHeuristically(text string) []entities.Character {
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
	out := make([]entities.Character, 0, len(arr))
	for _, it := range arr {
		out = append(out, entities.Character{Name: it.k})
	}
	return out
}

func mergeCharacters(base, updates []entities.Character) []entities.Character {
	byName := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	dst := make(map[string]entities.Character, len(base))
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

	out := make([]entities.Character, 0, len(dst))
	for _, k := range order {
		out = append(out, dst[k])
	}
	return out
}

func mergeOne(a, b entities.Character) entities.Character {
	// scalar preference: keep a if non-empty, else take b
	if a.Age == "" && b.Age != "" {
		a.Age = b.Age
	}
	if a.Gender == "" && b.Gender != "" {
		a.Gender = b.Gender
	}
	if a.Role == "" && b.Role != "" {
		a.Role = b.Role
	}
	if a.Personality == "" && b.Personality != "" {
		a.Personality = b.Personality
	}

	// nested: copy missing fields only
	if a.PhysicalDescription.Height == "" && b.PhysicalDescription.Height != "" {
		a.PhysicalDescription.Height = b.PhysicalDescription.Height
	}
	if a.PhysicalDescription.Build == "" && b.PhysicalDescription.Build != "" {
		a.PhysicalDescription.Build = b.PhysicalDescription.Build
	}
	if a.PhysicalDescription.Hair == "" && b.PhysicalDescription.Hair != "" {
		a.PhysicalDescription.Hair = b.PhysicalDescription.Hair
	}
	if a.PhysicalDescription.Other == "" && b.PhysicalDescription.Other != "" {
		a.PhysicalDescription.Other = b.PhysicalDescription.Other
	}

	if a.SexualCharacteristics.Genitalia == "" && b.SexualCharacteristics.Genitalia != "" {
		a.SexualCharacteristics.Genitalia = b.SexualCharacteristics.Genitalia
	}
	if a.SexualCharacteristics.PenisLengthFlaccid == nil && b.SexualCharacteristics.PenisLengthFlaccid != nil {
		a.SexualCharacteristics.PenisLengthFlaccid = b.SexualCharacteristics.PenisLengthFlaccid
	}
	if a.SexualCharacteristics.PenisLengthErect == nil && b.SexualCharacteristics.PenisLengthErect != nil {
		a.SexualCharacteristics.PenisLengthErect = b.SexualCharacteristics.PenisLengthErect
	}
	if a.SexualCharacteristics.PubicHair == "" && b.SexualCharacteristics.PubicHair != "" {
		a.SexualCharacteristics.PubicHair = b.SexualCharacteristics.PubicHair
	}
	if a.SexualCharacteristics.Other == "" && b.SexualCharacteristics.Other != "" {
		a.SexualCharacteristics.Other = b.SexualCharacteristics.Other
	}

	// list: union unique, preserve base order first then new
	if len(b.NotableActions) > 0 {
		seen := map[string]struct{}{}
		var out []string
		for _, s := range a.NotableActions {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
		for _, s := range b.NotableActions {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if _, ok := seen[s]; ok {
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
		a.NotableActions = out
	}

	return a
}

// guard if your Inferencer is missing capabilities
func require[T any](ok bool, _ T) error {
	if !ok {
		return errors.New("capability not implemented")
	}
	return nil
}

func (s *Server) handleSummarize(c echo.Context) error {
	type Req struct {
		Text      string             `json:"text"`
		Character entities.Character `json:"character"`
	}

	var req Req
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, utils.ErrJSON("invalid request"))
	}

	resp, err := s.Inferencer.Infer(s.Ctx, summarizePrompt, req.Text)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON(err.Error()))
	}

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"data":    resp,
	})
}

func (s *Server) handleExtractNames(c echo.Context) error {
	type Req struct {
		Text string `json:"text"`
	}

	var req Req
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, utils.ErrJSON("invalid request"))
	}

	resp, err := s.Inferencer.Infer(s.Ctx, nameExtractPrompt, req.Text)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON(err.Error()))
	}

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"data":    resp,
	})
}

// handlePostInfer runs inference and returns the model output.
func (s *Server) handlePostInfer(c echo.Context) error {
	type Req struct {
		System string `json:"system"`
		Text   string `json:"text"`
	}

	var req Req
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, utils.ErrJSON("invalid request"))
	}

	resp, err := s.Inferencer.Infer(s.Ctx, req.System, req.Text)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON(err.Error()))
	}

	return c.JSON(http.StatusOK, map[string]any{
		"success": true,
		"data":    resp,
	})
}

// handlePostVerify verifies inference results.
func (s *Server) handlePostVerify(c echo.Context) error {
	type Req struct {
		Input string `json:"input"`
	}

	var req Req
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, utils.ErrJSON("invalid request"))
	}

	ok, err := s.Inferencer.Verify(s.Ctx, req.Input)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, utils.ErrJSON(err.Error()))
	}

	return c.JSON(http.StatusOK, map[string]any{
		"verified": ok,
	})
}
