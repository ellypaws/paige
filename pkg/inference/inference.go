package inference

import (
	"context"

	"github.com/openai/openai-go/v3"
)

// Inferencer defines an interface for running model inference and verification.
type Inferencer interface {
	Infer(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error)
	Edit(ctx context.Context, params *openai.ChatCompletionNewParams, system, user string) (string, error)
	Verify(ctx context.Context, result string) (bool, error)
}
