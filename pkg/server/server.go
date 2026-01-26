package server

import (
	"context"
	"fmt"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"paige/pkg/flight"
	"paige/pkg/inference"
	"paige/pkg/queue"
	"paige/pkg/schema"
	"paige/pkg/utils"
)

type Server struct {
	Echo       *echo.Echo
	Inferencer inference.Inferencer
	Summary    map[string]schema.Summary
	Ctx        context.Context
	Queue      queue.Queue

	PortraitFlight flight.Cache[string, []byte]
	// PortraitParams stores the request params for in-flight requests.
	// Key matches the flight key.
	// Using generic sync.Map equivalent or just a mutex protected map.
	PortraitParams *utils.SyncMap[map[string]PortraitRequest, string, PortraitRequest]

	Forbids map[string]schema.Forbids
}

func NewServer(ctx context.Context, inf inference.Inferencer, q queue.Queue) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	e.Use(middleware.Logger())
	e.Use(middleware.CORS())

	s := &Server{
		Echo:           e,
		Inferencer:     inf,
		Ctx:            ctx,
		Queue:          q,
		PortraitParams: utils.NewSyncMap[map[string]PortraitRequest](),
	}

	s.PortraitFlight = flight.NewCache(func(key string) ([]byte, error) {
		req, ok := s.PortraitParams.Load(key)
		if !ok {
			return nil, fmt.Errorf("request params not found for key: %s", key)
		}
		return s.generateAndCachePortrait(req)
	})

	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	s.Echo.GET("/", s.handleGetRoot)

	api := s.Echo.Group("/api")
	api.POST("/names", s.handlePostNames)         // name detection -> []schema.Character (Name only required)
	api.POST("/summarize", s.handlePostSummarize) // extend/merge details -> []schema.Character
	api.POST("/edit", s.handlePostEdit)           // inline story edits

	// generate character portrait
	api.POST("/portrait", s.handlePostPortrait)
	api.GET("/portrait", s.handlePostPortrait)

	// optional: serve the userscript for @require http://localhost:8080/userscript
	s.Echo.GET("/userscript", s.handleGetUserscript)
}

func (s *Server) Start(addr string) error {
	utils.Logf("Server listening at %s", addr)
	return s.Echo.Start(addr)
}

func (s *Server) Shutdown(ctx context.Context) error {
	utils.Logf("Shutting down server...")

	saveErr := utils.Save("CharacterSummary.json", s.Summary)
	_ = utils.Save("Forbids.json", s.Forbids)
	shutDownErr := s.Echo.Shutdown(ctx)
	if shutDownErr != nil {
		return shutDownErr
	}

	return saveErr
}
