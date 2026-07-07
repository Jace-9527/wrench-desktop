package history

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
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
	db   *sql.DB
}

func NewStore(path string) (*Store, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("history path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	store := &Store{path: path, db: db}
	if err := store.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) init() error {
	statements := []string{
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS history_entries (
			id TEXT PRIMARY KEY,
			tool TEXT NOT NULL,
			title TEXT NOT NULL,
			input TEXT NOT NULL,
			output TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_history_tool_created ON history_entries(tool, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_history_created ON history_entries(created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
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

	_, err := s.db.Exec(
		`INSERT INTO history_entries (id, tool, title, input, output, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		entry.ID,
		entry.Tool,
		entry.Title,
		entry.Input,
		entry.Output,
		formatTime(entry.CreatedAt),
	)
	if err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) List(tool string, limit int) ([]Entry, error) {
	return s.Search(tool, "", limit, 0)
}

func (s *Store) Search(tool string, search string, limit int, offset int) ([]Entry, error) {
	tool = strings.TrimSpace(tool)
	search = strings.TrimSpace(search)
	if offset < 0 {
		offset = 0
	}

	sqlQuery := `SELECT id, tool, title, input, output, created_at FROM history_entries`
	args := []any{}
	clauses := []string{}
	if tool != "" {
		clauses = append(clauses, `tool = ?`)
		args = append(args, tool)
	}
	if search != "" {
		clauses = append(clauses, `(title LIKE ? ESCAPE '\' OR input LIKE ? ESCAPE '\' OR output LIKE ? ESCAPE '\')`)
		pattern := "%" + escapeLike(search) + "%"
		args = append(args, pattern, pattern, pattern)
	}
	if len(clauses) > 0 {
		sqlQuery += ` WHERE ` + strings.Join(clauses, ` AND `)
	}
	sqlQuery += ` ORDER BY created_at DESC, id DESC`
	if limit > 0 {
		sqlQuery += ` LIMIT ?`
		args = append(args, limit)
	} else if offset > 0 {
		sqlQuery += ` LIMIT -1`
	}
	if offset > 0 {
		sqlQuery += ` OFFSET ?`
		args = append(args, offset)
	}

	rows, err := s.db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []Entry{}
	for rows.Next() {
		var entry Entry
		var createdAt string
		if err := rows.Scan(&entry.ID, &entry.Tool, &entry.Title, &entry.Input, &entry.Output, &createdAt); err != nil {
			return nil, err
		}
		entry.CreatedAt, err = parseTime(createdAt)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) Delete(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("id is required")
	}
	_, err := s.db.Exec(`DELETE FROM history_entries WHERE id = ?`, id)
	return err
}

func (s *Store) Clear(tool string) error {
	tool = strings.TrimSpace(tool)
	if tool == "" {
		_, err := s.db.Exec(`DELETE FROM history_entries`)
		return err
	}
	_, err := s.db.Exec(`DELETE FROM history_entries WHERE tool = ?`, tool)
	return err
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
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return fmt.Sprintf("%d", now.UnixNano())
	}
	return fmt.Sprintf("%d-%s", now.UnixNano(), hex.EncodeToString(suffix[:]))
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, err
	}
	return parsed.UTC(), nil
}

func escapeLike(value string) string {
	var builder strings.Builder
	builder.Grow(len(value))
	for _, char := range value {
		switch char {
		case '\\', '%', '_':
			builder.WriteRune('\\')
		}
		builder.WriteRune(char)
	}
	return builder.String()
}
