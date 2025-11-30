package pool

import (
	"sync"
)

type Pool[T interface{ Reset() }] struct {
	pool sync.Pool
}

func New[T interface{ Reset() }](new func() T) *Pool[T] {
	return &Pool[T]{
		pool: sync.Pool{New: func() any { return new() }},
	}
}

func (p *Pool[T]) Get() T {
	t := p.pool.Get().(T)
	t.Reset()
	return t
}

func (p *Pool[T]) Put(x T) {
	p.pool.Put(x)
}
