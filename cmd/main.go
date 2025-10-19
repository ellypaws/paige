package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/labstack/gommon/log"

	"paige/pkg/inference"
	"paige/pkg/schema"
	"paige/pkg/server"
)

func main() {
	ctx := context.Background()

	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}

	apiKey := os.Getenv("OPENAI_API_KEY")
	openAI := inference.NewOpenAIInferencer(apiKey, model)
	if apiKey == "" {
		openAI.ChangeBaseURL("http://localhost:1234/v1")
		openAI.SetModel("")
	}
	var inf inference.Inferencer = openAI

	grokKey := os.Getenv("GROK_API_KEY")
	if grokKey != "" {
		inf = inference.NewGrokInferencer(grokKey, os.Getenv("GROK_MODEL"))
	}

	srv := server.NewServer(ctx, inf)
	srv.Echo.Logger.SetLevel(log.DEBUG)

	f, err := os.Open("CharacterSummary.json")
	if err == nil {
		var summaries map[string]schema.Summary
		err := json.NewDecoder(f).Decode(&summaries)
		if err != nil {
			log.Warnf("Failed to decode CharacterSummary.json: %v", err)
		} else {
			srv.Summary = summaries
			var char int
			for _, summary := range summaries {
				char += len(summary.Characters)
			}
			log.Infof("Loaded %d characters from CharacterSummary.json", char)
		}
	}

	addr := ":8080"
	if envAddr := os.Getenv("PORT"); envAddr != "" {
		addr = ":" + envAddr
	}

	if err := srv.Start(addr); err != nil {
		log.Fatal(err)
	}
}
