package utils

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func Load[T any](path string) (T, error) {
	var zero T
	f, err := os.Open(path)
	if err != nil {
		return zero, err
	}
	return zero, json.NewDecoder(f).Decode(&zero)
}

func Save[T any](path string, v T) error {
	if strings.Contains(filepath.Clean(path), string(os.PathSeparator)) {
		dir := filepath.Dir(path)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}

	f, err := os.Create(path)
	if err != nil {
		return err
	}

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")

	return enc.Encode(v)
}

type Saver[T any] struct {
	Path  string
	Value *T
}

func (s *Saver[T]) Save() error {
	return Save(s.Path, *s.Value)
}

func NewSaver[T any](path string, v *T) *Saver[T] {
	return &Saver[T]{path, v}
}

func LoadSaver[T any](path string) (*Saver[T], error) {
	v, err := Load[T](path)
	if err != nil {
		return nil, err
	}
	return &Saver[T]{Path: path, Value: &v}, nil
}
