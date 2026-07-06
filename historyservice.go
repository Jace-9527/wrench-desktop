package main

import (
	"os"
	"path/filepath"

	"wrench-desktop/internal/history"
)

type HistoryService struct {
	store *history.Store
}

func NewHistoryService() (*HistoryService, error) {
	store, err := history.NewStore(defaultHistoryPath())
	if err != nil {
		return nil, err
	}
	return &HistoryService{store: store}, nil
}

func (s *HistoryService) Create(req history.CreateRequest) (history.Entry, error) {
	return s.store.Create(req)
}

func (s *HistoryService) List(tool string, limit int) ([]history.Entry, error) {
	return s.store.List(tool, limit)
}

func (s *HistoryService) Delete(id string) error {
	return s.store.Delete(id)
}

func (s *HistoryService) Clear(tool string) error {
	return s.store.Clear(tool)
}

func (s *HistoryService) DataPath() string {
	return s.store.Path()
}

func defaultHistoryPath() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		base = "."
	}
	// This file is intentionally outside the app bundle so upgrades keep user history.
	return filepath.Join(base, "Wrench Desktop", "history.jsonl")
}
