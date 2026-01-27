package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gen2brain/webp"
	"github.com/labstack/echo/v4"

	"paige/pkg/schema"
	"paige/pkg/utils"
)

// ensureImageDir creates the directory if it doesn't exist
func ensureImageDir() error {
	path := filepath.Join("images", "portraits")
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return os.MkdirAll(path, 0755)
	}
	return nil
}

// saveToWebP saves the image to the specified path as a high-quality WebP.
func saveToWebP(r io.Reader, filename string) ([]byte, error) {
	if err := ensureImageDir(); err != nil {
		return nil, fmt.Errorf("failed to create image dir: %w", err)
	}

	// 1. Decode PNG
	// The queue returns a reader which we expect to be PNG (from NovelAI).
	// We might need to read it fully first.
	imgBytes, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read image data: %w", err)
	}

	img, err := png.Decode(bytes.NewReader(imgBytes))
	if err != nil {
		// Fallback: try generic decode if not PNG
		var err2 error
		img, _, err2 = image.Decode(bytes.NewReader(imgBytes))
		if err2 != nil {
			return nil, fmt.Errorf("failed to decode image (png: %v, generic: %v)", err, err2)
		}
	}

	buf := new(bytes.Buffer)
	err = webp.Encode(buf, img, webp.Options{Lossless: false, Quality: 100})
	if err != nil {
		return nil, fmt.Errorf("failed to encode webp: %w", err)
	}

	fullPath := filepath.Join("images", "portraits", filename)
	if err := os.WriteFile(fullPath, buf.Bytes(), 0644); err != nil {
		return nil, fmt.Errorf("failed to write file %s: %w", fullPath, err)
	}

	return buf.Bytes(), nil
}

type PortraitRequest struct {
	ID     string `json:"id,omitempty"`
	Source string `json:"source,omitempty"`
	Name   string `json:"name,omitempty"`

	Summary string `json:"summary,omitempty"`
	Style   string `json:"style,omitempty"`
	Force   bool   `json:"force,omitempty"`
}

type PortraitPromptResponse struct {
	General    string               `json:"general"`
	Characters []schema.CharCaption `json:"characters"`
	Negative   string               `json:"negative"`
}

// POST /api/portrait
func (s *Server) handlePostPortrait(c echo.Context) error {
	var req PortraitRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid json")
	}

	if req.Source != "" && req.ID != "" {
		req.ID = req.Source + ":" + req.ID
	}
	if req.Summary == "" {
		if s.Summary != nil {
			if sum, ok := s.Summary[req.ID]; ok {
				nameLower := strings.ToLower(strings.TrimSpace(req.Name))
				for _, ch := range sum.Characters {
					if strings.ToLower(strings.TrimSpace(ch.Name)) == nameLower || slices.ContainsFunc(ch.Aliases, func(a string) bool {
						return strings.ToLower(strings.TrimSpace(a)) == nameLower
					}) {
						// Found character, use full details as prompt
						log.Infof("Found character summary for %s in %s", req.Name, req.ID)
						b, err := json.MarshalIndent(ch, "", "  ")
						if err == nil {
							req.Summary = string(b)
						}
						break
					}
				}
			}
		}

		if req.Summary == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "character description is required and not found in summary")
		}
	}

	if s.Queue == nil {
		return echo.NewHTTPError(http.StatusServiceUnavailable, "queue not configured") // Or handle in flight check
	}

	safeID := utils.SanitizeFilename(req.ID)
	safeName := utils.SanitizeFilename(req.Name)
	key := fmt.Sprintf("%s-%s.webp", safeID, safeName)
	s.PortraitParams.Store(key, req)

	var data []byte
	var err error
	if req.Force {
		data, err = s.PortraitFlight.Force(key)
	} else {
		data, err = s.PortraitFlight.Get(key)
	}

	if err != nil {
		log.Errorf("Portrait generation/retrieval failed: %v", err)
		return echo.NewHTTPError(http.StatusInternalServerError, "generation failed: "+err.Error())
	}

	c.Response().Header().Set(echo.HeaderContentType, "image/webp")
	c.Response().WriteHeader(http.StatusOK)
	_, err = c.Response().Write(data)
	return err
}

func (s *Server) generateAndCachePortrait(req PortraitRequest) ([]byte, error) {
	safeID := utils.SanitizeFilename(req.ID)
	safeName := utils.SanitizeFilename(req.Name)
	if safeID == "" {
		safeID = "unknown"
	}
	if safeName == "" {
		safeName = "unknown"
	}

	prefix := "inkbunny-"
	if strings.HasPrefix(strings.ToLower(safeID), "inkbunny") {
		prefix = ""
	}
	filename := fmt.Sprintf("%s%s-%s.webp", prefix, safeID, safeName)
	fullPath := filepath.Join("images", "portraits", filename)

	if !req.Force {
		if data, err := os.ReadFile(fullPath); err == nil {
			log.Infof("Cache hit for portrait: %s", filename)
			return data, nil
		}
	} else {
		log.Infof("Force regenerating portrait for %s (%s)", req.Name, req.ID)
	}

	forbidID := fmt.Sprintf("portrait:%s character:%s", req.ID, req.Name)
	var useFallback bool
	if _, ok := s.Forbids[forbidID]; ok {
		log.Infof("Skipping inference for forbidden character: %s", forbidID)
		useFallback = true
	}

	log.Infof("Generating portrait for %s (%s)", req.Name, req.ID)

	var resp PortraitPromptResponse
	var err error

	if !useFallback {
		resp, err = s.inferPortraitTags(req)
		if err != nil {
			log.Errorf("Inference failed for %s: %v. Falling back to manual tags.", forbidID, err)
			s.Forbids[forbidID] = schema.Forbids{
				Reason: "inference failed",
				Text:   req.Summary,
				Raw:    err.Error(),
			}
			useFallback = true
		}
	}

	if useFallback {
		resp, err = s.manualBuildPortraitTags(req.Summary)
		if err != nil {
			return nil, fmt.Errorf("manual tag building failed: %w", err)
		}
		log.Infof("Used manual fallback strategy for %s", forbidID)
	}

	// Apply quality and style tags
	resp.General = qualityTags + resp.General + styleTags

	naiReq := schema.DefaultNovelAIRequest()
	naiReq.SetPrompts(resp.General, resp.Characters, resp.Negative)

	if s.Queue == nil {
		return nil, fmt.Errorf("queue not configured")
	}

	respCh, errCh, err := s.Queue.Add(naiReq)
	if err != nil {
		return nil, fmt.Errorf("queue add failed: %w", err)
	}

	select {
	case <-s.Ctx.Done():
		return nil, s.Ctx.Err()
	case err := <-errCh:
		return nil, fmt.Errorf("generation failed: %w", err)
	case images := <-respCh:
		if len(images) == 0 {
			return nil, fmt.Errorf("no images generated")
		}
		data, err := saveToWebP(images[0], filename)
		if err != nil {
			return nil, fmt.Errorf("failed to save webp: %w", err)
		}
		return data, nil
	}
}

func (s *Server) inferPortraitTags(req PortraitRequest) (PortraitPromptResponse, error) {
	input := req.Summary
	if req.Style != "" {
		input += "\nStyle: " + req.Style
	}

	var resp PortraitPromptResponse
	respJSON, err := s.Inferencer.Infer(s.Ctx, nil, portraitPrompt, input)
	if err != nil {
		return resp, err
	}

	respJSON = utils.CleanJSON(respJSON)
	if err := json.Unmarshal([]byte(respJSON), &resp); err != nil {
		fixed, err := s.Inferencer.Infer(s.Ctx, nil, fixJSONPrompt, respJSON)
		if err == nil {
			fixed = utils.CleanJSON(fixed)
			if err := json.Unmarshal([]byte(fixed), &resp); err != nil {
				return resp, fmt.Errorf("failed to parse tags (fixed): %w", err)
			}
		} else {
			return resp, fmt.Errorf("failed to parse tags: %w", err)
		}
	}
	return resp, nil
}

func (s *Server) manualBuildPortraitTags(summaryJSON string) (PortraitPromptResponse, error) {
	var c schema.Character
	if err := json.Unmarshal([]byte(summaryJSON), &c); err != nil {
		return PortraitPromptResponse{}, fmt.Errorf("failed to unmarshal character summary: %w", err)
	}

	var parts []string

	// 1. Hair/Fur
	if c.PhysicalDescription.Hair != "" {
		parts = append(parts, c.PhysicalDescription.Hair)
	}
	if c.PhysicalDescription.Fur != "" {
		if c.PhysicalDescription.Hair == "" {
			// Infer hair color from fur if hair not specified
			parts = append(parts, c.PhysicalDescription.Fur+" hair")
		}
		parts = append(parts, c.PhysicalDescription.Fur)
	}

	// 2. Ears - Try to infer from species or description
	if strings.Contains(strings.ToLower(c.Species), "wolf") {
		parts = append(parts, "wolf ears")
	} else if strings.Contains(strings.ToLower(c.Species), "fox") {
		parts = append(parts, "fox ears")
	} else if strings.Contains(strings.ToLower(c.Species), "cat") || strings.Contains(strings.ToLower(c.Species), "feline") {
		parts = append(parts, "cat ears")
	} else if strings.Contains(strings.ToLower(c.Species), "dog") || strings.Contains(strings.ToLower(c.Species), "canine") {
		parts = append(parts, "dog ears")
	}

	parts = append(parts, c.PhysicalDescription.Other)

	// 4. Physical details
	if c.PhysicalDescription.Build != "" {
		parts = append(parts, c.PhysicalDescription.Build)
	}
	// "tall" or "short"?
	if strings.Contains(strings.ToLower(c.PhysicalDescription.Height), "short") {
		parts = append(parts, "short")
	} else if strings.Contains(strings.ToLower(c.PhysicalDescription.Height), "tall") {
		parts = append(parts, "tall")
	}

	// 5. Sexual Characteristics (Genitalia)
	if c.SexualCharacteristics.Genitalia != "" {
		parts = append(parts, c.SexualCharacteristics.Genitalia)
	}
	if c.SexualCharacteristics.PenisLengthErect != nil && *c.SexualCharacteristics.PenisLengthErect != "" {
		parts = append(parts, "erection")
	}

	// 6. Species / Type Tags
	if c.Species != "" {
		parts = append(parts, c.Species)
	}
	parts = append(parts, "anthro", "furry")

	caption := strings.Join(parts, ", ")

	return PortraitPromptResponse{
		General: "",
		Characters: []schema.CharCaption{
			{
				Centers:     []schema.Center{{X: 0, Y: 0}},
				CharCaption: caption,
			},
		},
		Negative: "lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped",
	}, nil
}
