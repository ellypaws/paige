package server

import (
	"context"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"paige/pkg/inference"
	"paige/pkg/utils"
)

type Server struct {
	Echo       *echo.Echo
	Inferencer inference.Inferencer
	Ctx        context.Context
}

func NewServer(ctx context.Context, inf inference.Inferencer) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	e.Use(middleware.Recover())
	e.Use(middleware.Logger())
	e.Use(middleware.CORS())

	s := &Server{
		Echo:       e,
		Inferencer: inf,
		Ctx:        ctx,
	}

	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	// existing
	s.Echo.GET("/", s.handleGetRoot)
	s.Echo.POST("/infer", s.handlePostInfer)
	s.Echo.POST("/verify", s.handlePostVerify)

	// new api group for the userscript
	api := s.Echo.Group("/api")
	api.POST("/names", s.handlePostNames)         // name detection -> []entities.Character (Name only required)
	api.POST("/summarize", s.handlePostSummarize) // extend/merge details -> []entities.Character

	// optional: serve the userscript for @require http://localhost:8080/userscript
	s.Echo.GET("/userscript", s.handleGetUserscript)
}

func (s *Server) Start(addr string) error {
	utils.Logf("Server listening at %s", addr)
	return s.Echo.Start(addr)
}

func (s *Server) Shutdown(ctx context.Context) error {
	utils.Logf("Shutting down server...")
	return s.Echo.Shutdown(ctx)
}

// handleGetRoot — defined in get.go
// handlePostInfer — defined in post.go
// handlePostVerify — defined in post.go
