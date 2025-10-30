package utils

import (
	"bytes"
	"cmp"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
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

// Levenshtein returns the edit distance between two strings.
func Levenshtein(a, b string) int {
	ar, br := []rune(a), []rune(b)
	al, bl := len(ar), len(br)
	if al == 0 {
		return bl
	}
	if bl == 0 {
		return al
	}

	dist := make([][]int, al+1)
	for i := range dist {
		dist[i] = make([]int, bl+1)
	}
	for i := 0; i <= al; i++ {
		dist[i][0] = i
	}
	for j := 0; j <= bl; j++ {
		dist[0][j] = j
	}

	for i := 1; i <= al; i++ {
		for j := 1; j <= bl; j++ {
			cost := 0
			if ar[i-1] != br[j-1] {
				cost = 1
			}
			min := dist[i-1][j] + 1
			if v := dist[i][j-1] + 1; v < min {
				min = v
			}
			if v := dist[i-1][j-1] + cost; v < min {
				min = v
			}
			dist[i][j] = min
		}
	}
	return dist[al][bl]
}

// Similarity returns a float between 0 and 1 (1 = identical).
func Similarity(a, b string) float64 {
	a, b = strings.ToLower(strings.TrimSpace(a)), strings.ToLower(strings.TrimSpace(b))
	if a == "" && b == "" {
		return 1.0
	}
	dist := Levenshtein(a, b)
	maxLen := float64(max(utf8.RuneCountInString(a), utf8.RuneCountInString(b)))
	if maxLen == 0 {
		return 0
	}
	return 1.0 - float64(dist)/maxLen
}

var paragraphRX = regexp.MustCompile(`\n{2,}`)

func ChunkText(text string, limit int) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if runeLen(text) <= limit {
		return []string{text}
	}

	// Decide primary block unit: paragraphs, else single lines, else whole text.
	var blocks []string
	var joiner string
	if paragraphRX.FindStringIndex(text) != nil {
		blocks = paragraphRX.Split(text, -1)
		joiner = "\n\n"
	} else if strings.Contains(text, "\n") {
		blocks = strings.Split(text, "\n")
		joiner = "\n"
	} else {
		blocks = []string{text}
		joiner = " "
	}

	out := make([]string, 0, len(blocks))
	cur := ""

	var appendPiece func(piece string)
	appendPiece = func(piece string) {
		piece = strings.TrimSpace(piece)
		if piece == "" {
			return
		}
		if cur == "" {
			if runeLen(piece) <= limit {
				cur = piece
				return
			}
			// piece itself too large: split by spaces safely
			for _, p := range splitBySpaceRune(piece, limit) {
				if cur == "" {
					cur = p
				} else if runeLen(cur)+runeLen(joiner)+runeLen(p) <= limit {
					cur = cur + joiner + p
				} else {
					out = append(out, cur)
					cur = p
				}
			}
			return
		}
		// Try to add with joiner
		if runeLen(cur)+runeLen(joiner)+runeLen(piece) <= limit {
			cur = cur + joiner + piece
			return
		}
		// Flush and handle piece
		out = append(out, cur)
		cur = ""
		appendPiece(piece)
	}

	for _, b := range blocks {
		b = strings.TrimSpace(b)
		if b == "" {
			continue
		}
		// If block fits, try to pack as-is; otherwise split by spaces.
		if runeLen(b) <= limit {
			appendPiece(b)
		} else {
			for _, p := range splitBySpaceRune(b, limit) {
				appendPiece(p)
			}
		}
	}

	if strings.TrimSpace(cur) != "" {
		out = append(out, cur)
	}
	return out
}

type Paragraph struct {
	Index int
	Text  string
}

func ChunkParagraph(paras map[string]string, limit int) [][]Paragraph {
	if limit <= 0 || len(paras) == 0 {
		return nil
	}

	paragraphs := make([]Paragraph, 0, len(paras))
	for k, v := range paras {
		v = strings.TrimSpace(v)
		if v != "" {
			idx, err := strconv.Atoi(k)
			if err != nil {
				Logf("ChunkParagraph: could not parse paragraph key to int: %s", k)
				continue
			}
			paragraphs = append(paragraphs, Paragraph{Index: idx, Text: v})
		}
	}
	if len(paragraphs) == 0 {
		return nil
	}

	slices.SortFunc(paragraphs, func(a, b Paragraph) int {
		return cmp.Compare(a.Index, b.Index)
	})

	const joiner = "\n\n"
	jlen := runeLen(joiner)

	var out [][]Paragraph
	var cur []Paragraph
	curLen := 0

	flush := func() {
		if len(cur) > 0 {
			out = append(out, cur)
			cur = nil
			curLen = 0
		}
	}

	for _, p := range paragraphs {
		plen := runeLen(p.Text)

		if plen > limit {
			flush()
			out = append(out, []Paragraph{p})
			continue
		}

		add := plen
		if curLen > 0 {
			add += jlen
		}

		if curLen+add <= limit {
			cur = append(cur, p)
			curLen += add
		} else {
			flush()
			cur = append(cur, p)
			curLen = plen
		}
	}

	if len(cur) > 0 {
		out = append(out, cur)
	}

	return out
}

func splitBySpaceRune(s string, limit int) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if runeLen(s) <= limit {
		return []string{s}
	}
	var parts []string
	for s != "" {
		if runeLen(s) <= limit {
			parts = append(parts, s)
			break
		}
		idx := lastWhitespaceByteIndexBeforeRuneLimit(s, limit)
		if idx <= 0 {
			// No whitespace before limit; hard-cut at rune boundary
			cut := byteIndexAtRunePos(s, limit)
			parts = append(parts, strings.TrimSpace(s[:cut]))
			s = strings.TrimSpace(s[cut:])
			continue
		}
		parts = append(parts, strings.TrimSpace(s[:idx]))
		s = strings.TrimLeftFunc(s[idx:], unicode.IsSpace)
	}
	return parts
}

func lastWhitespaceByteIndexBeforeRuneLimit(s string, limit int) int {
	rc := 0
	last := -1
	for i, r := range s {
		if rc >= limit {
			break
		}
		if unicode.IsSpace(r) {
			last = i
		}
		rc++
	}
	return last
}

func byteIndexAtRunePos(s string, pos int) int {
	if pos <= 0 {
		return 0
	}
	i := 0
	for pos > 0 && i < len(s) {
		_, sz := utf8.DecodeRuneInString(s[i:])
		i += sz
		pos--
	}
	return i
}

func runeLen(s string) int { return utf8.RuneCountInString(s) }

type SSEWriter struct {
	c    echo.Context
	w    http.ResponseWriter
	fl   http.Flusher
	done bool
}

// NewSSEWriter initializes SSE headers and returns a writer.
func NewSSEWriter(c echo.Context) *SSEWriter {
	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	if f, ok := w.Writer.(http.Flusher); ok {
		f.Flush()
		return &SSEWriter{c: c, w: w, fl: f}
	}

	panic("SSE not supported: ResponseWriter not flushable")
}

// Event sends an SSE event with an event name and data (struct/map/string).
func (s *SSEWriter) Event(event string, data any) error {
	if s.done {
		return nil
	}
	var payload string
	switch v := data.(type) {
	case string:
		payload = v
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		payload = string(b)
	}
	fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, payload)
	s.fl.Flush()
	return nil
}

// Close finalizes the stream.
func (s *SSEWriter) Close() {
	if s.done {
		return
	}
	s.done = true
	fmt.Fprint(s.w, "event: close\ndata: null\n\n")
	s.fl.Flush()
}

// CompressToBase64 compresses text using gzip and encodes it as Base64.
// The result is safe to store in JSON.
func CompressToBase64(s string) (string, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte(s)); err != nil {
		gz.Close()
		return "", err
	}
	if err := gz.Close(); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// DecompressFromBase64 decodes Base64 and decompresses gzip-compressed text.
func DecompressFromBase64(encoded string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	defer r.Close()

	out, err := io.ReadAll(r)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
