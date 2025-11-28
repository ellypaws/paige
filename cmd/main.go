package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	logger "github.com/charmbracelet/log"
	_ "github.com/joho/godotenv/autoload"
	"github.com/labstack/gommon/log"

	"paige/pkg/inference"
	"paige/pkg/schema"
	"paige/pkg/server"
	"paige/pkg/utils"
)

func main() {
	ctx, done := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM, syscall.SIGKILL)

	model := os.Getenv("OPENAI_MODEL")
	apiKey := os.Getenv("OPENAI_API_KEY")
	openAI := inference.NewOpenAIInferencer(apiKey, model)
	var inf inference.Inferencer
	if apiKey != "" {
		inf = openAI
		logger.Info("Using OpenAI as inferencer")
	} else if grokKey := os.Getenv("GROK_API_KEY"); grokKey != "" {
		inf = inference.NewGrokInferencer(grokKey, os.Getenv("GROK_MODEL"))
		logger.Info("Using Grok as inferencer")
	} else if geminiKey := os.Getenv("GEMINI_API_KEY"); geminiKey != "" {
		var err error
		inf, err = inference.NewGeminiInferencer(geminiKey, os.Getenv("GEMINI_MODEL"))
		if err != nil {
			logger.Fatal(err)
		}
		logger.Info("Using Gemini as inferencer")
	} else {
		openAI.ChangeBaseURL("http://localhost:1234/v1")
		openAI.SetModel("")
		inf = openAI
		logger.Info("Using local LM Studio as inferencer")
	}

	srv := server.NewServer(ctx, inf)
	srv.Echo.Logger.SetLevel(log.DEBUG)

	summaries, err := utils.Load[map[string]schema.Summary]("CharacterSummary.json")
	if err == nil && summaries != nil {
		srv.Summary = summaries
		var char int
		for _, summary := range summaries {
			char += len(summary.Characters)
		}
		log.Infof("Loaded %d characters from %d stories", char, len(summaries))
	} else {
		summary := make(map[string]schema.Summary)
		srv.Summary = summary
		if !errors.Is(err, os.ErrNotExist) {
			log.Warnf("Failed to load CharacterSummary.json: %v", err)
		}
	}

	forbids, _ := utils.Load[map[string]schema.Forbids]("Forbids.json")
	if forbids == nil {
		forbids = make(map[string]schema.Forbids)
	}
	srv.Forbids = forbids

	addr := ":8080"
	if envAddr := os.Getenv("PORT"); envAddr != "" {
		addr = ":" + envAddr
	}

	finishedShutDown := make(chan struct{})
	go func() {
		<-ctx.Done()
		if err := srv.Shutdown(ctx); err != nil {
			log.Fatal(err)
		}
		done()
		close(finishedShutDown)
	}()

	if err := srv.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error(err)
	}
	<-finishedShutDown
}
