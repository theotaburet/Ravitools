FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY . .

# AUDIT R5: don't run the server (and Playwright's Chromium) as root.
RUN chown -R bun:bun /app
USER bun

EXPOSE 3001

# AUDIT S9: let the orchestrator detect a server that started but isn't serving.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["bun", "src/index.ts"]
