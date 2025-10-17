package main

import (
	"context"
	"log"
	"os"

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

	addr := ":8080"
	if envAddr := os.Getenv("PORT"); envAddr != "" {
		addr = ":" + envAddr
	}

	if err := srv.Start(addr); err != nil {
		log.Fatal(err)
	}
}
