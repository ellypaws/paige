package main

import (
	"context"
	"encoding/json"
	"os"

	"github.com/labstack/gommon/log"

	"paige/pkg/entities"
	"paige/pkg/inference"
	"paige/pkg/server"
)

func main() {
	ctx := context.Background()

	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		// log.Fatal("OPENAI_API_KEY environment variable not set")
	}

	model := os.Getenv("OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}

	inf := inference.NewOpenAIInferencer(apiKey, model)
	inf.ChangeBaseURL("http://localhost:1234/v1")
	inf.SetModel("")
	srv := server.NewServer(ctx, inf)
	srv.Echo.Logger.SetLevel(log.DEBUG)

	f, err := os.Open("CharacterSummary.json")
	if err == nil {
		var summary entities.Summary
		err := json.NewDecoder(f).Decode(&summary)
		if err != nil {
			log.Warnf("Failed to decode CharacterSummary.json: %v", err)
		} else {
			srv.Characters = summary.Characters
			log.Infof("Loaded %d characters from CharacterSummary.json", len(srv.Characters))
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
