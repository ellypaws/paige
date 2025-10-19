package schema

import (
	"github.com/invopop/jsonschema"
	"github.com/openai/openai-go/v3"
)

func generateSchema[T any]() any {
	r := jsonschema.Reflector{
		AllowAdditionalProperties: false,
		DoNotReference:            true,
	}
	var v T
	return r.Reflect(v)
}

var StorySummarySchema = generateSchema[Summary]()

func StructuredOutputsResponseFormat() openai.ChatCompletionNewParamsResponseFormatUnion {
	p := openai.ResponseFormatJSONSchemaJSONSchemaParam{
		Name:        "story_summary",
		Description: openai.String("Characters and timeline extracted from a fictional story"),
		Schema:      StorySummarySchema,
		Strict:      openai.Bool(true),
	}
	return openai.ChatCompletionNewParamsResponseFormatUnion{
		OfJSONSchema: &openai.ResponseFormatJSONSchemaParam{JSONSchema: p},
	}
}
