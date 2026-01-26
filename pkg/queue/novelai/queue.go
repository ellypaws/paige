package novelai

import (
	"errors"
	"io"
	"log"
	"strings"
	"sync"

	"paige/pkg/schema"
)

type Queue struct {
	client *Client
	stop   chan struct{}
	items  chan *Item
	mu     sync.Mutex
}

type Item struct {
	Request  *schema.NovelAIRequest
	Response chan []io.Reader
	Error    chan error
}

func New(token string) *Queue {
	return &Queue{
		client: NewNovelAIClient(token),
		items:  make(chan *Item, 100),
		stop:   make(chan struct{}),
	}
}

func (q *Queue) Start() {
	go q.processLoop()
}

func (q *Queue) Stop() {
	close(q.stop)
}

func (q *Queue) Add(req *schema.NovelAIRequest) (chan []io.Reader, chan error, error) {
	respCh := make(chan []io.Reader, 1)
	errCh := make(chan error, 1)

	select {
	case q.items <- &Item{
		Request:  req,
		Response: respCh,
		Error:    errCh,
	}:
		return respCh, errCh, nil
	default:
		return nil, nil, errors.New("queue is full")
	}
}

func (q *Queue) processLoop() {
	log.Println("NovelAI Queue started")
	for {
		select {
		case <-q.stop:
			log.Println("NovelAI Queue stopped")
			return
		case item := <-q.items:
			q.processItem(item)
		}
	}
}

func (q *Queue) processItem(item *Item) {
	req := item.Request

	log.Printf("Processing generation: %s...", limitStr(req.Input, 50))

	resp, err := q.client.Inference(req)
	if err != nil {
		log.Printf("Generation failed: %v", err)
		item.Error <- err
		close(item.Response)
		return
	}

	item.Response <- resp.Images
	close(item.Error)
}

func cleanPrompt(s string) string {
	// Simple cleanup: remove double commas, extra spaces
	s = strings.ReplaceAll(s, ",,", ",")
	s = strings.TrimSpace(s)
	return s
}

func limitStr(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
