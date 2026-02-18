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

type KimiInferencer struct {
	client *openai.Client
	apiKey string
	model  string
}

// NewKimiInferencer creates a new inferencer instance using Kimi (Moonshot AI) OpenAI-compatible API.
func NewKimiInferencer(apiKey string, model string) *KimiInferencer {
	if model == "" {
		model = "kimi-for-coding"
	}
	client := openai.NewClient(
		option.WithBaseURL("https://api.kimi.com/coding/v1"),
		option.WithAPIKey(apiKey),
	)
	return &KimiInferencer{
		client: &client,
		apiKey: apiKey,
		model:  model,
	}
}

func (o *KimiInferencer) ChangeBaseURL(baseURL string) {
	client := openai.NewClient(
		option.WithAPIKey(o.apiKey),
		option.WithBaseURL(baseURL),
	)
	o.client = &client
}

func (o *KimiInferencer) SetModel(model string) {
	o.model = model
}

// Infer sends text to the Kimi chat completion endpoint and returns the output.
func (o *KimiInferencer) Infer(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error) {
	if params == nil {
		params = new(openai.ChatCompletionNewParams)
	} else {
		params = &(*params)
	}
	params.Model = cmp.Or(params.Model, o.model)
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

	params.MaxCompletionTokens = openai.Int(cmp.Or(params.MaxCompletionTokens.Value, 4096))
	params.Temperature = openai.Float(cmp.Or(params.Temperature.Value, 0.3))
	params.TopP = openai.Float(cmp.Or(params.TopP.Value, 1.0))

	resp, err := o.client.Chat.Completions.New(ctx, *params)
	if err != nil {
		return "", fmt.Errorf("kimi inference error: %w", err)
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
func (o *KimiInferencer) Edit(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error) {
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
func (o *KimiInferencer) Verify(ctx context.Context, result string) (bool, error) {
	if result == "" {
		return false, errors.New("empty result")
	}
	return true, nil
}
