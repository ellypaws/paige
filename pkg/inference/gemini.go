package inference

import (
	"cmp"
	"context"
	"errors"
	"fmt"

	"github.com/openai/openai-go/v3"
	"google.golang.org/genai"
)

type GeminiInferencer struct {
	client *genai.Client
	apiKey string
	model  string
}

// NewGeminiInferencer creates a new inferencer instance using OpenAI client.
func NewGeminiInferencer(apiKey string, model string) (*GeminiInferencer, error) {
	if model == "" {
		model = "gemini-2.5-flash"
	}
	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{APIKey: apiKey})
	if err != nil {
		return nil, err
	}
	return &GeminiInferencer{
		client: client,
		apiKey: apiKey,
		model:  model,
	}, nil
}

func (o *GeminiInferencer) ChangeConfig(config *genai.ClientConfig) {
	client, err := genai.NewClient(context.Background(), config)
	if err != nil {
		return
	}
	o.client = client
}

// Infer sends text to the OpenAI chat completion endpoint and returns the output.
func (o *GeminiInferencer) Infer(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error) {
	if params == nil {
		params = new(openai.ChatCompletionNewParams)
	}
	config := &genai.GenerateContentConfig{
		SystemInstruction: genai.NewContentFromText(system, genai.RoleModel),
		ResponseMIMEType:  "application/json",
		MaxOutputTokens:   int32(params.MaxCompletionTokens.Value),
	}

	result, err := o.client.Models.GenerateContent(
		ctx,
		cmp.Or(params.Model, o.model),
		genai.Text(user),
		config,
	)
	if err != nil {
		return "", fmt.Errorf("failed to generate content: %w", err)
	}

	return result.Text(), nil
}

// Verify checks that the result is non-empty or conforms to minimal expectations.
// You could extend this with an OpenAI-based validation or JSON schema.
func (o *GeminiInferencer) Verify(ctx context.Context, result string) (bool, error) {
	if result == "" {
		return false, errors.New("empty result")
	}
	return true, nil
}
