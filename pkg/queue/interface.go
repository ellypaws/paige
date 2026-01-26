package queue

import (
	"io"

	"paige/pkg/schema"
)

type Queue interface {
	Start()
	Stop()
	Add(req *schema.NovelAIRequest) (chan []io.Reader, chan error, error)
}
