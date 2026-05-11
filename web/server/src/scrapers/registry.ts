/**
 * Central registry of scraper plugins.
 *
 * Each entry exposes:
 *   - the plugin object (validation, URL building, fetch implementation)
 *   - the legacy base path used before the generic system existed
 *
 * `mountAllScrapers()` instantiates one `ScraperJobSystem` per plugin and
 * mounts both the canonical `/scrape/{name}` routes and the legacy alias
 * routes on the Express app. Adding a new scraper = one entry in the array.
 */

import type { Express, RequestHandler } from "express";
import type { Logger } from "pino";
import { googleMapsPlugin } from "./google-maps.js";
import { yandexMapsPlugin } from "./yandex-maps.js";
import { createScraperJobSystem, type ScraperJobSystem } from "./job-system.js";
import { mountScraperEndpoints } from "./endpoints.js";
import type { MapPreview, MapScraperPlugin, ScraperDeps } from "./types.js";

interface RegistryEntry {
  plugin: MapScraperPlugin<MapPreview>;
  /**
   * Legacy path mounted in addition to the canonical `/scrape/{name}` path.
   * `null` means there is no legacy path (new scrapers should set this to null).
   */
  legacyBasePath: string | null;
}

const REGISTRY: RegistryEntry[] = [
  // Cast widens the per-plugin generic to `MapPreview`. Safe because each
  // plugin only ever interacts with its own `ScraperJobSystem<T>` after this.
  { plugin: googleMapsPlugin as MapScraperPlugin<MapPreview>, legacyBasePath: "/google-maps-preview" },
  { plugin: yandexMapsPlugin as MapScraperPlugin<MapPreview>, legacyBasePath: "/yandex-maps-preview" },
];

export interface MountAllResult {
  systems: Map<string, ScraperJobSystem<MapPreview>>;
}

export interface MountAllOptions {
  app: Express;
  deps: ScraperDeps;
  limiter?: RequestHandler;
  log: Logger;
}

export function mountAllScrapers(options: MountAllOptions): MountAllResult {
  const systems = new Map<string, ScraperJobSystem<MapPreview>>();

  for (const entry of REGISTRY) {
    const system = createScraperJobSystem(entry.plugin, options.deps);
    system.load(); // restore persisted jobs from disk (if any)
    systems.set(entry.plugin.name, system);

    // Canonical route family
    mountScraperEndpoints(options.app, entry.plugin, system, {
      limiter: options.limiter,
      log: options.log,
    });

    // Legacy alias (preserves existing client integrations unchanged)
    if (entry.legacyBasePath) {
      mountScraperEndpoints(options.app, entry.plugin, system, {
        basePath: entry.legacyBasePath,
        limiter: options.limiter,
        log: options.log,
      });
    }
  }

  return { systems };
}

/** For tests / introspection */
export function listRegisteredScrapers(): readonly RegistryEntry[] {
  return REGISTRY;
}
