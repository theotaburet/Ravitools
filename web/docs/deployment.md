# VPS Deployment

## Static demo (GitHub Pages)

`ci.yml` publishes the client to <https://theotaburet.github.io/Ravitools/> on every
push to `main`, once typecheck, tests and lint pass. No server is involved:

```bash
cd web/client
VITE_STANDALONE=true bunx vite build --base=/Ravitools/
```

- `VITE_STANDALONE=true` makes the browser query Overpass directly
  (`overpass-api.de`, then `maps.mail.ru`, the mirrors that send CORS headers).
- The enrich step is hidden: SearXNG, page scraping and the PostGIS cache need the server.
- The GPX still never leaves the browser.

The rest of this page deploys the full app, server included, on a VPS.

## Prerequisites

- A VPS with [Bun](https://bun.sh) 1.x and nginx (or Docker: see `web/server/Dockerfile`)
- A domain name (optional but recommended)

## 1. Build

On your local machine or CI:

```bash
# From the repo root
bun install --frozen-lockfile
cd web/client && bun run build
# Result: web/client/dist/
```

The server has no build step: Bun runs `src/index.ts` directly.

## 2. Upload to VPS

```bash
rsync -avz web/client/dist/ user@vps:/var/www/ravitools/
rsync -avz --exclude node_modules web/server/ user@vps:/opt/ravitools-server/
```

## 3. Install server dependencies on VPS

```bash
ssh user@vps
cd /opt/ravitools-server
bun install --production
```

## 4. Systemd service

Create `/etc/systemd/system/ravitools.service`:

```ini
[Unit]
Description=Ravitools Overpass Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/ravitools-server
ExecStart=/usr/local/bin/bun src/index.ts
Restart=on-failure
RestartSec=5

Environment=PORT=3001
Environment=NODE_ENV=production
Environment=CACHE_TTL=86400
Environment=RATE_LIMIT_MAX=10
Environment=SEARXNG_URL=http://localhost:8080
Environment=NOMINATIM_URL=https://nominatim.openstreetmap.org

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ravitools
sudo systemctl start ravitools
```

## 5. Nginx configuration

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Static frontend
    root /var/www/ravitools;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API to the Bun server
    location /api/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

For HTTPS, add certbot:

```bash
sudo certbot --nginx -d yourdomain.com
```

## 6. Verify

```bash
# Health check
curl http://localhost:3001/health

# Frontend
curl -I https://yourdomain.com/
```

## Production env vars

| Variable | Recommended value | Notes |
|---|---|---|
| `PORT` | `3001` | Keep behind nginx |
| `NODE_ENV` | `production` | Disables pretty logging |
| `CACHE_TTL` | `86400` | 24h, Overpass cache |
| `RATE_LIMIT_MAX` | `10` | Per minute per IP (Overpass) |
| `OVERPASS_URL` | default | Or a private Overpass instance |
| `SEARXNG_URL` | `http://localhost:8080` | SearXNG instance for POI enrichment |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Reverse geocoding for enrichment |
| `SEARCH_CACHE_TTL` | `604800` | 7 days, search results cache |
| `GEOCODE_CACHE_TTL` | `2592000` | 30 days, geocode results cache |

## 7. SearXNG (optional, for POI enrichment)

The enrichment feature requires a SearXNG instance for web search. Without it, enrichment will fail gracefully (POIs are still usable without enrichment).

```bash
# Quick setup with Docker
docker run -d \
  --name searxng \
  -p 8080:8080 \
  -e SEARXNG_SECRET=$(openssl rand -hex 32) \
  searxng/searxng:latest
```

Ensure SearXNG has JSON format enabled in its settings (`settings.yml`):

```yaml
search:
  formats:
    - html
    - json
```

The server will proxy search requests to `SEARXNG_URL` (default `http://localhost:8080`).

## Monitoring

The server logs via `pino` to stdout. Systemd captures this in journal:

```bash
journalctl -u ravitools -f
```

For alerting, check `/health` endpoint periodically.

## Scaling notes

- **Cache**: the in-memory caches (`src/caches.ts`) are lost on restart. For persistence, swap them for Redis.
- **Multiple instances**: the server is stateless (except cache). Run multiple behind a load balancer if needed.
- **Overpass alternatives**: if the public Overpass instance is too slow, consider a private Overpass instance or switching to a different endpoint.
