# Task: Browser session partagée + cookies persistés (Google)
Started: 2026-05-10
Status: done

## Goal
Partager un BrowserContext Playwright unique entre tous les scrapes Google Maps, avec cookies persistés sur disque, pour réduire le taux de captcha en réutilisant l'identité de session.

## Steps
- [x] Module `browser-context.ts` : `getBrowserContext`, `saveBrowserState` (debounced 30s), `closeBrowserContext`, `_resetBrowserContextForTests`
- [x] Refactor `fetchGoogleMapsPreviewOnce` : utilise context partagé, supprime randomisation locale/UA/viewport par page
- [x] Save fire-and-forget après chaque extraction (debounce protège)
- [x] Shutdown handler : flush+close context avant browser.close
- [x] 8 tests dédiés mockant Playwright (load/save/debounce/close/error fallback)
- [x] tsc clean (server+client), build OK, tests 103/103 server + 492/492 client

## Decisions
- Locale fixe `fr-FR` (override env `GOOGLE_MAPS_LOCALE`), UA fixe (override `GOOGLE_MAPS_USER_AGENT`)
- Path : `web/server/.cache/browser-state.json` (déjà gitignored par `web/*/.cache/`)
- Debounce 30s, bypass via `force=true` au shutdown
- Tous les errors swallowed côté save (jamais bloquant)

