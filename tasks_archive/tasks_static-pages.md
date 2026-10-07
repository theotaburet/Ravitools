# Task: Demo statique sur GitHub Pages
Started: 2026-10-07
Status: done

## Steps
- [x] Build `VITE_STANDALONE=true`: Overpass appelé directement depuis le navigateur, miroirs en rotation
- [x] Masquer l'étape Enrichir en standalone (SearXNG, scraping, cache PostGIS = serveur)
- [x] Test unitaire de l'appel direct et de la rotation des miroirs
- [x] Déploiement Pages dans `ci.yml`, après typecheck + tests + lint
- [x] Doc: README + `web/docs/deployment.md`
- [x] Build statique sur un vrai GPX (loire-tours-saumur) contre Overpass: 1127 POI, aucun appel `/api`

## Decisions
- GitHub Pages plutôt qu'un VPS: démo gratuite, le GPX et le calcul restent dans le navigateur.
- Miroirs directs: overpass-api.de et maps.mail.ru, les seuls qui renvoient `Access-Control-Allow-Origin: *` (vérifié le 2026-10-07; kumi.systems et private.coffee ne répondaient pas).
- Corps `URLSearchParams` = requête CORS simple, pas de preflight.
- Déploiement dans `ci.yml` (job `pages`, `needs: build-test`) plutôt qu'un workflow séparé: rien n'est publié si la CI casse.
- Pages doit être activé une fois dans le repo (Settings → Pages → Source: GitHub Actions).
