package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/charmbracelet/log"
	"github.com/labstack/echo/v4"
	"github.com/openai/openai-go/v3"

	"paige/pkg/schema"
	"paige/pkg/utils"
)

type summarizeReq struct {
	Text       string             `json:"text"`
	ID         string             `json:"id,omitempty"`
	Source     string             `json:"source,omitempty"`
	Chapter    string             `json:"chapter,omitempty"`
	Characters []schema.Character `json:"characters"`
	Timeline   []schema.Timeline  `json:"timeline"`
	Paragraphs map[string]string  `json:"paragraphs,omitempty"`
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
			summary.StoredHeat = make(map[string]map[string]float64)
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
