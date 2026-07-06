package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	historyService, err := NewHistoryService()
	if err != nil {
		log.Fatal(err)
	}

	app := application.New(application.Options{
		Name:        "Wrench Desktop",
		Description: "Local toolbox with saved input history.",
		Services: []application.Service{
			application.NewService(historyService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Wrench Desktop",
		Width:            1280,
		Height:           820,
		MinWidth:         980,
		MinHeight:        640,
		BackgroundColour: application.NewRGB(246, 247, 249),
		URL:              "/",
	})
	window.Center()
	window.Show()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
