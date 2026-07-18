# Ravitools — `just` pour lister les recettes

client_dir := "web/client"
server_dir := "web/server"

default:
    @just --list

# Installe toutes les dépendances (workspaces Bun)
install:
    bun install

# Dev servers
client:
    cd {{client_dir}} && bun run dev

server:
    cd {{server_dir}} && bun run dev

# Build production
build:
    cd {{client_dir}} && bun run build

# Preview du build client
preview:
    cd {{client_dir}} && bun run preview

# Serveur en mode production
server-start:
    cd {{server_dir}} && bun run start

# Tests
test: test-client test-server

test-client:
    cd {{client_dir}} && bun run test

test-server:
    cd {{server_dir}} && bun run test

test-e2e:
    cd {{client_dir}} && bun run test:e2e

# Typecheck
typecheck:
    cd {{client_dir}} && bun run typecheck
    cd {{server_dir}} && bun run typecheck

# Lint / format
lint:
    cd {{client_dir}} && bun run lint
    cd {{server_dir}} && bun run lint

format:
    cd {{client_dir}} && bun run format
    cd {{server_dir}} && bun run format

# Vérification complète (politique zéro warning)
check: typecheck test lint

# SearXNG (Docker, pour l'enrichissement)
searxng:
    #!/usr/bin/env bash
    if docker info >/dev/null 2>&1; then
        docker rm -f searxng >/dev/null 2>&1 || true
        docker run -d -p 8888:8080 --rm --name searxng \
            -v "$(pwd)/searxng/settings.yml:/etc/searxng/settings.yml:ro" \
            -v "$(pwd)/searxng/limiter.toml:/etc/searxng/limiter.toml:ro" \
            -e SEARXNG_BASE_URL=http://localhost:8888 \
            searxng/searxng
        echo "SearXNG démarré sur http://localhost:8888"
    else
        echo "Docker ne tourne pas. Lance Docker Desktop puis relance 'just searxng'"
    fi

searxng-stop:
    docker rm -f searxng >/dev/null 2>&1 && echo "SearXNG arrêté" || echo "SearXNG non démarré"

# Stoppe serveur (3001) et client (5173)
stop: searxng-stop
    -lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    -lsof -ti:5173 | xargs kill -9 2>/dev/null || true
    @echo "Stoppé: serveur (3001) et client (5173)"
