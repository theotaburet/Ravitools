# POI Categories & OSM Tags

This document lists all V1 POI categories, their OSM tag matchers, and design rationale.

## Source of truth

The category definitions live in `web/client/src/lib/poi-config.ts`, ported from the Python project's `config/config.yaml`.

## Categories

### Water

**Priority: critical** – most important for bikepacking.

| OSM key | OSM value | Notes |
|---|---|---|
| `amenity` | `water_point` | Dedicated water filling station |
| `amenity` | `drinking_water` | Public drinking water fountain |

**Not included (yet)**: `natural=spring` (often not potable), `man_made=water_tap` (rare tagging).

### Sleeping place

**Priority: critical** – second most important after water.

| OSM key | OSM value | Notes |
|---|---|---|
| `tourism` | `camp_site` | Primary target for bikepackers |
| `tourism` | `hostel` | Budget indoor option |
| `tourism` | `alpine_hut` | Mountain shelter with beds |
| `tourism` | `chalet` | Rental cabin |
| `tourism` | `guest_house` | B&B style |
| `tourism` | `motel` | Roadside accommodation |
| `tourism` | `hotel` | Last resort, usually expensive |

### Restroom

| OSM key | OSM value |
|---|---|
| `amenity` | `toilets` |
| `amenity` | `shower` |

### Shelter

| OSM key | OSM value |
|---|---|
| `amenity` | `shelter` |

Includes bus shelters, picnic shelters, etc. Useful for rain/wind protection.

### Food shop

| OSM key | OSM value | Notes |
|---|---|---|
| `shop` | `supermarket` | Main resupply |
| `shop` | `convenience` | Quick resupply |
| `shop` | `bakery` | Common in France |
| `shop` | `butcher` | |
| `shop` | `greengrocer` | |
| `shop` | `farm` | Farm shop / direct sale |
| `shop` | `food` | Generic food shop |
| ... | ... | 20+ more food shop types |

### Restaurant or Bar

| OSM key | OSM value |
|---|---|
| `amenity` | `restaurant` |
| `amenity` | `cafe` |
| `amenity` | `fast_food` |
| `amenity` | `bar` |
| `amenity` | `pub` |
| `amenity` | `biergarten` |
| `amenity` | `food_court` |
| `amenity` | `ice_cream` |

### Gears (bike shops)

| OSM key | OSM value |
|---|---|
| `shop` | `bicycle` |
| `shop` | `outdoor` |
| `shop` | `sports` |

### DIY (repair)

| OSM key | OSM value |
|---|---|
| `amenity` | `bicycle_repair_station` |

Public repair stations with tools and pump. Very valuable for bikepackers.

### Laundry

| OSM key | OSM value |
|---|---|
| `shop` | `laundry` |

## Corridor and filtering

- **Overpass radius**: 1000m around the simplified trace
- **Post-filter cutoff**: 1500m perpendicular distance to nearest trace segment
- **Deduplication**: 50m radius, same category, keeps the POI with most OSM tags

## Adding a new category

1. Add the category name to `PoiCategory` type in `types/index.ts`
2. Add the config entry to `POI_CATEGORIES` in `lib/poi-config.ts`
3. Specify OSM tag matchers, icon, and style colors
4. Rebuild and test

No server changes needed – all matching happens client-side.
