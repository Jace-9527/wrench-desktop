.PHONY: test frontend-build wails-dev wails-build clean

GO ?= /usr/local/go/bin/go

test:
	$(GO) test ./internal/...
	node --test frontend/src/*.test.js

frontend-build:
	rm -rf frontend/dist
	mkdir -p frontend/dist
	cp frontend/index.html frontend/dist/index.html
	cp -R frontend/src frontend/dist/src
	rm -f frontend/dist/src/*.test.js
	cp -R frontend/public frontend/dist/public
	if [ -d frontend/bindings ]; then cp -R frontend/bindings frontend/dist/bindings; fi

wails-dev:
	$(GO) mod tidy
	wails3 generate bindings -clean=true -b
	$(MAKE) frontend-build
	mkdir -p bin
	$(GO) build -buildvcs=false -gcflags=all="-l" -o bin/wrench-desktop .
	./bin/wrench-desktop

wails-build: frontend-build
	wails3 build

clean:
	rm -rf frontend/dist bin
