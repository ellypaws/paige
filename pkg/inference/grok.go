package inference

import (
	"context"
	"errors"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
)

type GrokInferencer struct {
	client *openai.Client
	apiKey string
	model  string
}

// NewGrokInferencer creates a new inferencer instance using OpenAI client.
func NewGrokInferencer(apiKey string, model string) *GrokInferencer {
	if model == "" {
		model = "grok-4-fast-reasoning"
	}
	client := openai.NewClient(
		option.WithBaseURL("https://api.x.ai/v1"),
		option.WithAPIKey(apiKey),
	)
	return &GrokInferencer{
		client: &client,
		apiKey: apiKey,
		model:  model,
	}
}

func (o *GrokInferencer) ChangeBaseURL(baseURL string) {
	client := openai.NewClient(
		option.WithAPIKey(o.apiKey),
		option.WithBaseURL(baseURL),
	)
	o.client = &client
}

func (o *GrokInferencer) SetModel(model string) {
	o.model = model
}

// Infer sends text to the OpenAI chat completion endpoint and returns the output.
func (o *GrokInferencer) Infer(ctx context.Context, system, user string) (string, error) {
	params := openai.ChatCompletionNewParams{
		Model: o.model,
		Messages: []openai.ChatCompletionMessageParamUnion{
			{
				OfSystem: &openai.ChatCompletionSystemMessageParam{
					Role: "system",
					Content: openai.ChatCompletionSystemMessageParamContentUnion{
						OfString: param.Opt[string]{Value: system},
					},
				}},
			{
				OfUser: &openai.ChatCompletionUserMessageParam{
					Role: "user",
					Content: openai.ChatCompletionUserMessageParamContentUnion{
						OfString: param.Opt[string]{Value: user},
					},
				},
			},
		},
		MaxCompletionTokens: openai.Int(1024),
		Temperature:         openai.Float(0.3),
		TopP:                openai.Float(1.0),
	}

	resp, err := o.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return "", fmt.Errorf("openai inference error: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", errors.New("no choices returned")
	}
	if resp.Choices[0].Message.Content == "" {
		return "", errors.New("empty completion content")
	}

	return resp.Choices[0].Message.Content, nil
}

// Verify checks that the result is non-empty or conforms to minimal expectations.
// You could extend this with an OpenAI-based validation or JSON schema.
func (o *GrokInferencer) Verify(ctx context.Context, result string) (bool, error) {
	if result == "" {
		return false, errors.New("empty result")
	}
	return true, nil
}
