package utils

import (
	"encoding/json"
	"log"
)

// Logf prints consistent server logs.
func Logf(format string, v ...any) {
	log.Printf("[Paige] "+format, v...)
}

// ErrJSON produces a standard JSON error response.
func ErrJSON(msg string) map[string]any {
	return map[string]any{
		"success": false,
		"error":   msg,
	}
}

// PrettyJSON marshals with indentation.
func PrettyJSON(v any) string {
	data, _ := json.MarshalIndent(v, "", "  ")
	return string(data)
}
