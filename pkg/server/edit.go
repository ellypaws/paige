package server

import (
	"cmp"
	"net/http"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"github.com/labstack/echo/v4"
	"github.com/openai/openai-go/v3"
	"github.com/segmentio/ksuid"

	"paige/pkg/schema"
	"paige/pkg/utils"
)

type editReq struct {
	ID            string   `json:"id"`
	Chapter       string   `json:"chapter,omitempty"`
	Prompt        string   `json:"prompt"`
	Rules         string   `json:"rules"`
	Selection     string   `json:"selection"`
	ParagraphKeys []string `json:"paragraph_keys,omitempty"`
	Source        string   `json:"source,omitempty"`
}

const (
	maxEditSelectionRunes = 8192 * 4
	maxEditHistoryEntries = 50
)

func (s *Server) handlePostEdit(c echo.Context) error {
	var req editReq
	if err := c.Bind(&req); err != nil {
		log.Warn("invalid JSON in /api/edit", "error", err)
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}
	if req.Source != "" && req.ID != "" {
		req.ID = strings.TrimSpace(req.Source) + ":" + strings.TrimSpace(req.ID)
	}
	if req.ID == "" || req.Selection == "" || req.Prompt == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id, selection, and prompt are required")
	}

	runes := []rune(req.Selection)
	if len(runes) > maxEditSelectionRunes {
		req.Selection = string(runes[:maxEditSelectionRunes])
	}

	ctx := c.Request().Context()
	params := &openai.ChatCompletionNewParams{
		MaxCompletionTokens: openai.Int(int64(cmp.Or(len(req.Selection)*2, 4096))),
		Temperature:         openai.Float(0.25),
		TopP:                openai.Float(1.0),
	}
	systemPrompt := buildEditSystemPrompt(req.Rules, req.Prompt)
	result, err := s.Inferencer.Edit(ctx, params, systemPrompt, req.Selection)
	if err != nil {
		log.Error("edit inference failed", "error", err)
		return echo.NewHTTPError(http.StatusBadGateway, "edit inference failed")
	}
	result = strings.TrimSpace(result)
	if result == "" {
		return echo.NewHTTPError(http.StatusBadGateway, "empty edit result")
	}

	if s.Summary == nil {
		s.Summary = make(map[string]schema.Summary)
	}
	summary := s.Summary[req.ID]
	if summary.Edits == nil {
		summary.Edits = make(map[string][]schema.EditHistoryEntry)
	}
	if summary.Chapters == nil {
		summary.Chapters = make(map[string]bool)
	}
	chapterKey := strings.TrimSpace(req.Chapter)
	if chapterKey != "" {
		summary.Chapters[chapterKey] = true
	}

	entry := schema.EditHistoryEntry{
		ID:            ksuid.New().String(),
		Chapter:       chapterKey,
		Prompt:        req.Prompt,
		Rules:         req.Rules,
		Original:      req.Selection,
		Result:        result,
		ParagraphKeys: dedupeStrings(req.ParagraphKeys),
		CreatedAt:     time.Now().UTC().Format(time.RFC3339),
	}
	history := summary.Edits[chapterKey]
	history = append([]schema.EditHistoryEntry{entry}, history...)
	if len(history) > maxEditHistoryEntries {
		history = history[:maxEditHistoryEntries]
	}
	summary.Edits[chapterKey] = history
	s.Summary[req.ID] = summary
	if err := utils.Save("CharacterSummary.json", s.Summary); err != nil {
		log.Warn("failed saving summary data after edit", "error", err)
	}

	log.Info("edit complete", "id", req.ID, "chapter", chapterKey, "entries", len(history))

	return c.JSON(http.StatusOK, map[string]any{
		"result":  result,
		"entry":   entry,
		"chapter": chapterKey,
		"history": history,
	})
}

func dedupeStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
