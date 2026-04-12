# VPS Deployment

## Prerequisites

- A VPS with Node.js >= 18 and nginx
- A domain name (optional but recommended)

## 1. Build

On your local machine or CI:

```bash
# Client
cd web/client
npm ci
npm run build
# Result: web/client/dist/

# Server
cd ../server
npm ci
npm run build
# Result: web/server/dist/
```

## 2. Upload to VPS

```bash
rsync -avz web/client/dist/ user@vps:/var/www/ravitools/
rsync -avz web/server/dist/ user@vps:/opt/ravitools-server/dist/
rsync -avz web/server/package.json web/server/package-lock.json user@vps:/opt/ravitools-server/
```

## 3. Install server dependencies on VPS

```bash
ssh user@vps
cd /opt/ravitools-server
npm ci --omit=dev
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
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

Environment=PORT=3001
Environment=NODE_ENV=production
Environment=CACHE_TTL=86400
Environment=RATE_LIMIT_MAX=10
Environment=CORS_ORIGIN=https://yourdomain.com
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

    # Proxy API to Node server
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

# Cache stats
curl http://localhost:3001/cache/stats

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
| `CORS_ORIGIN` | `https://yourdomain.com` | Lock down in prod |
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

- **Cache**: current in-memory cache is lost on restart. For persistence, swap `node-cache` for Redis.
- **Multiple instances**: the server is stateless (except cache). Run multiple behind a load balancer if needed.
- **Overpass alternatives**: if the public Overpass instance is too slow, consider a private Overpass instance or switching to a different endpoint.
