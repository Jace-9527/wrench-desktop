package main

import (
	"errors"
	"fmt"
	"net/url"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type WindowService struct {
	mu  sync.RWMutex
	app *application.App
}

func NewWindowService() *WindowService {
	return &WindowService{}
}

func (s *WindowService) setApp(app *application.App) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.app = app
}

func (s *WindowService) OpenTool(toolID string) error {
	title, ok := toolWindowTitles[toolID]
	if !ok {
		return fmt.Errorf("unknown tool: %s", toolID)
	}

	s.mu.RLock()
	app := s.app
	s.mu.RUnlock()
	if app == nil {
		return errors.New("application is not ready")
	}

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            title + " - Wrench",
		Width:            1120,
		Height:           760,
		MinWidth:         860,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(246, 247, 249),
		URL:              "/?mode=tool&tool=" + url.QueryEscape(toolID),
	})
	window.Center()
	window.Show()
	window.Focus()
	return nil
}

var toolWindowTitles = map[string]string{
	"json":     "JSON 解析器",
	"pg-array": "PG Array 转换",
	"base64":   "Base64 编解码",
	"url":      "URL 编解码",
	"csr":      "CSR 格式化",
	"cert":     "证书格式化",
}
