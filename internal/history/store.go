package history

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Entry struct {
	ID        string    `json:"id"`
	Tool      string    `json:"tool"`
	Title     string    `json:"title"`
	Input     string    `json:"input"`
	Output    string    `json:"output"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreateRequest struct {
	Tool   string `json:"tool"`
	Title  string `json:"title"`
	Input  string `json:"input"`
	Output string `json:"output"`
}

type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("history path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		file, createErr := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if createErr != nil {
			return nil, createErr
		}
		return &Store{path: path}, file.Close()
	}
	return &Store{path: path}, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Create(req CreateRequest) (Entry, error) {
	tool := strings.TrimSpace(req.Tool)
	if tool == "" {
		return Entry{}, errors.New("tool is required")
	}
	if req.Input == "" && req.Output == "" {
		return Entry{}, errors.New("input or output is required")
	}

	entry := Entry{
		ID:        newID(time.Now()),
		Tool:      tool,
		Title:     strings.TrimSpace(req.Title),
		Input:     req.Input,
		Output:    req.Output,
		CreatedAt: time.Now().UTC(),
	}
	if entry.Title == "" {
		entry.Title = defaultTitle(entry)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return Entry{}, err
	}
	defer file.Close()

	line, err := json.Marshal(entry)
	if err != nil {
		return Entry{}, err
	}
	if _, err := file.Write(append(line, '\n')); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) List(tool string, limit int) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := s.readAllLocked()
	if err != nil {
		return nil, err
	}

	tool = strings.TrimSpace(tool)
	out := make([]Entry, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		if tool != "" && entries[i].Tool != tool {
			continue
		}
		out = append(out, entries[i])
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (s *Store) Delete(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := s.readAllLocked()
	if err != nil {
		return err
	}

	next := entries[:0]
	deleted := false
	for _, entry := range entries {
		if entry.ID == id {
			deleted = true
			continue
		}
		next = append(next, entry)
	}
	if !deleted {
		return nil
	}
	return s.writeAllLocked(next)
}

func (s *Store) Clear(tool string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tool = strings.TrimSpace(tool)
	if tool == "" {
		return os.WriteFile(s.path, nil, 0o600)
	}

	entries, err := s.readAllLocked()
	if err != nil {
		return err
	}
	next := entries[:0]
	for _, entry := range entries {
		if entry.Tool != tool {
			next = append(next, entry)
		}
	}
	return s.writeAllLocked(next)
}

func (s *Store) readAllLocked() ([]Entry, error) {
	file, err := os.OpenFile(s.path, os.O_CREATE|os.O_RDONLY, 0o600)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []Entry
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry Entry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			return nil, fmt.Errorf("decode history line %d: %w", lineNo, err)
		}
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}

func (s *Store) writeAllLocked(entries []Entry) error {
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriter(file)
	for _, entry := range entries {
		line, err := json.Marshal(entry)
		if err != nil {
			_ = file.Close()
			return err
		}
		if _, err := writer.Write(append(line, '\n')); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := writer.Flush(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func defaultTitle(entry Entry) string {
	if entry.Input == "" {
		return entry.Tool
	}
	text := strings.Join(strings.Fields(entry.Input), " ")
	if len([]rune(text)) > 48 {
		runes := []rune(text)
		text = string(runes[:48]) + "..."
	}
	if text == "" {
		return entry.Tool
	}
	return text
}

func newID(now time.Time) string {
	return fmt.Sprintf("%d", now.UnixNano())
}
