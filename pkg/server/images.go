package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gen2brain/webp"

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

func (s *Server) generateAndCachePortrait(req PortraitRequest) ([]byte, error) {
	// Construct key/filename
	// "inkbunny-{id}-{name}.webp"
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

	if data, err := os.ReadFile(fullPath); err == nil {
		log.Infof("Cache hit for portrait: %s", filename)
		return data, nil
	}

	log.Infof("Generating portrait for %s (%s)", req.Name, req.ID)

	input := req.Summary
	if req.Style != "" {
		input += "\nStyle: " + req.Style
	}

	ctx := s.Ctx

	respJSON, err := s.Inferencer.Infer(ctx, nil, portraitPrompt, input)
	if err != nil {
		return nil, fmt.Errorf("inference failed: %w", err)
	}

	respJSON = utils.CleanJSON(respJSON)
	var llmResp PortraitPromptResponse
	if err := json.Unmarshal([]byte(respJSON), &llmResp); err != nil {
		fixed, err := s.Inferencer.Infer(ctx, nil, fixJSONPrompt, respJSON)
		if err == nil {
			fixed = utils.CleanJSON(fixed)
			if err := json.Unmarshal([]byte(fixed), &llmResp); err != nil {
				return nil, fmt.Errorf("failed to parse tags: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to parse tags: %w", err)
		}
	}

	naiReq := schema.DefaultNovelAIRequest()
	naiReq.SetPrompts(llmResp.General, llmResp.Characters, llmResp.Negative)

	if s.Queue == nil {
		return nil, fmt.Errorf("queue not configured")
	}

	respCh, errCh, err := s.Queue.Add(naiReq)
	if err != nil {
		return nil, fmt.Errorf("queue add failed: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
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
