package main

import (
	"os"
	"sync"
)

// Preloader — фоновая предзагрузка изображений в память
// Исключает зависания при переходе между кадрами
type Preloader struct {
	mu       sync.RWMutex
	cache    map[string][]byte
	queue    chan string
	workers  int
	stopChan chan struct{}
}

// NewPreloader создаёт предзагрузчик с N параллельными воркерами
func NewPreloader(workers int) *Preloader {
	p := &Preloader{
		cache:    make(map[string][]byte),
		queue:    make(chan string, 32),
		workers:  workers,
		stopChan: make(chan struct{}),
	}
	for i := 0; i < workers; i++ {
		go p.worker()
	}
	return p
}

// Preload ставит список путей в очередь на загрузку
func (p *Preloader) Preload(paths []string) {
	for _, path := range paths {
		p.mu.RLock()
		_, cached := p.cache[path]
		p.mu.RUnlock()
		if !cached {
			select {
			case p.queue <- path:
			default:
				// очередь заполнена — пропускаем
			}
		}
	}
}

// Get возвращает данные файла из кеша (nil если не загружен)
func (p *Preloader) Get(path string) []byte {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.cache[path]
}

// Evict удаляет файл из кеша (для освобождения памяти)
func (p *Preloader) Evict(path string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.cache, path)
}

// Stop останавливает все воркеры предзагрузчика
func (p *Preloader) Stop() {
	close(p.stopChan)
}

func (p *Preloader) worker() {
	for {
		select {
		case <-p.stopChan:
			return
		case path := <-p.queue:
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			p.mu.Lock()
			p.cache[path] = data
			p.mu.Unlock()
		}
	}
}
