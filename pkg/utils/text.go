package utils

import (
	"unicode"

	"github.com/aryann/difflib"
)

func TokenizeWords(s string) []string {
	var out []string
	var cur []rune
	kind := -1 // 0=space,1=word,2=punct
	flush := func() {
		if len(cur) == 0 {
			return
		}
		out = append(out, string(cur))
		cur = cur[:0]
	}
	for _, r := range s {
		k := 2
		switch {
		case unicode.IsSpace(r):
			k = 0
		case unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_' || r == '-' || r == '\'':
			k = 1
		}
		if kind == -1 {
			kind = k
		}
		if k != kind {
			flush()
			kind = k
		}
		cur = append(cur, r)
	}
	flush()
	return out
}

type WordDelta struct {
	Op   int
	Text string
}

func DiffWords(a, b string) []WordDelta {
	at := TokenizeWords(a)
	bt := TokenizeWords(b)
	recs := difflib.Diff(at, bt)
	out := make([]WordDelta, 0, len(recs))
	for _, r := range recs {
		switch r.Delta {
		case difflib.Common:
			out = append(out, WordDelta{Op: 0, Text: r.Payload})
		case difflib.LeftOnly:
			out = append(out, WordDelta{Op: -1, Text: r.Payload})
		case difflib.RightOnly:
			out = append(out, WordDelta{Op: +1, Text: r.Payload})
		}
	}
	return out
}
