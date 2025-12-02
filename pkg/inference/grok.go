package inference

import (
	"cmp"
	"context"
	"errors"
	"fmt"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
)

type GrokInferencer struct {
	client *openai.Client
	apiKey string
	model  string
}

// NewGrokInferencer creates a new inferencer instance using OpenAI client.
func NewGrokInferencer(apiKey string, model string) *GrokInferencer {
	if model == "" {
		model = "grok-4-1-fast-non-reasoning"
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
func (o *GrokInferencer) Infer(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error) {
	if params == nil {
		params = new(openai.ChatCompletionNewParams)
	} else {
		params = &(*params)
	}
	params.Model = cmp.Or(params.Model, o.model)
	if len(params.Messages) == 0 {
		params.Messages = []openai.ChatCompletionMessageParamUnion{
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
		}
	}

	params.MaxCompletionTokens = openai.Int(cmp.Or(params.MaxCompletionTokens.Value, 4096))
	params.Temperature = openai.Float(cmp.Or(params.Temperature.Value, 0.3))
	params.TopP = openai.Float(cmp.Or(params.TopP.Value, 1.0))

	resp, err := o.client.Chat.Completions.New(ctx, *params)
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

// Edit wraps Infer with editing defaults to encourage grounded rewrites.
func (o *GrokInferencer) Edit(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error) {
	if params == nil {
		params = new(openai.ChatCompletionNewParams)
	}
	if params.MaxCompletionTokens.Value == 0 {
		params.MaxCompletionTokens = openai.Int(int64(len(user) * 2))
	}
	if params.Temperature.Value == 0 {
		params.Temperature = openai.Float(0.2)
	}
	return o.Infer(ctx, params, system, user)
}

// Verify checks that the result is non-empty or conforms to minimal expectations.
// You could extend this with an OpenAI-based validation or JSON schema.
func (o *GrokInferencer) Verify(ctx context.Context, result string) (bool, error) {
	if result == "" {
		return false, errors.New("empty result")
	}
	return true, nil
}
