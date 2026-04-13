# Ravitools Makefile
# Usage: make <target>

.PHONY: help install client client-build client-start server server-build server-start searxng all

help:
	@echo "Ravitools targets:"
	@echo "  make install       - Install all dependencies"
	@echo "  make client       - Start frontend dev server (Vite)"
	@echo "  make client-build - Build frontend for production"
	@echo "  make client-start - Start frontend preview (production build)"
	@echo "  make server      - Start backend dev server"
	@echo "  make server-build - Build backend for production"
	@echo "  make server-start - Start backend from production build"
	@echo "  make searxng       - Start SearXNG (Docker)"
	@echo "  make all          - Start searxng + server + client"

install:
	cd web/client && npm install && cd web/client && npm audit fix --force
	cd web/server && npm install && cd web/server && npm audit fix --force

# Client (frontend)
client:
	cd web/client && npm run dev

client-build:
	cd web/client && npm run build

client-start:
	cd web/client && npm run preview

# Server (backend)
server:
	cd web/server && npm run dev

server-build:
	cd web/server && npm run build

server-start:
	cd web/server && npm start

# SearXNG (search engine)
searxng:
	@if docker info >/dev/null 2>&1; then \
		docker run -d -p 8888:8080 --rm --name searxng searxng/searxng; \
	else \
		echo "Docker not running. Please start Docker Desktop and retry 'make searxng'"; \
	fi

# All services
all: searxng
	@echo "SearXNG started. Run 'make server' and 'make client' in different terminals."