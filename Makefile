.PHONY: test frontend-build wails-dev wails-build clean

test:
	go test ./internal/...

frontend-build:
	rm -rf frontend/dist
	mkdir -p frontend/dist
	cp frontend/index.html frontend/dist/index.html
	cp -R frontend/src frontend/dist/src
	rm -f frontend/dist/src/*.test.js
	cp -R frontend/public frontend/dist/public
	if [ -d frontend/bindings ]; then cp -R frontend/bindings frontend/dist/bindings; fi

wails-dev: frontend-build
	wails3 dev

wails-build: frontend-build
	wails3 build

clean:
	rm -rf frontend/dist bin
