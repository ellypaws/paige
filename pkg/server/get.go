package server

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

func (s *Server) handleGetRoot(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{
		"service": "Paige Inference API",
		"status":  "ok",
	})
}
