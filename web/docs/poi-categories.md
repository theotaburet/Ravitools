# POI Categories & OSM Tags

This document lists all 18 POI categories, their OSM tag matchers, and design rationale.

## Source of truth

The category definitions live in `web/client/src/lib/poi-config.ts`, ported from the Python project's `config/config.yaml` and extended with optional categories.

## Essential categories (enabled by default)

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
| `shop` | `deli` | |
| `shop` | `cheese` | |
| `shop` | `pastry` | |
| `shop` | `seafood` | |
| `shop` | `alcohol` | |
| `shop` | `beverages` | |
| `shop` | `frozen_food` | |
| `shop` | `health_food` | |
| `shop` | `water` | |
| `shop` | `wine` | |
| `shop` | `coffee` | |
| `shop` | `tea` | |
| `shop` | `chocolate` | |
| `shop` | `confectionery` | |
| `shop` | `dairy` | |
| `shop` | `ice_cream` | |
| `shop` | `nuts` | |
| `shop` | `pasta` | |
| `shop` | `spices` | |
| `shop` | `brewing_supplies` | |
| `shop` | `tortilla` | |

28 food shop types covering European diversity.

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

Color: `#E65100` (distinct from Gears `#CC0000`).

### Laundry

| OSM key | OSM value |
|---|---|
| `shop` | `laundry` |

## Optional categories (disabled by default, user opts in)

### Medical

| OSM key | OSM value |
|---|---|
| `amenity` | `hospital` |
| `amenity` | `clinic` |
| `amenity` | `doctors` |
| `amenity` | `dentist` |
| `amenity` | `veterinary` |

### Pharmacy

| OSM key | OSM value |
|---|---|
| `amenity` | `pharmacy` |

### Bank & ATM

| OSM key | OSM value |
|---|---|
| `amenity` | `atm` |
| `amenity` | `bank` |
| `amenity` | `bureau_de_change` |

### Post office

| OSM key | OSM value |
|---|---|
| `amenity` | `post_office` |
| `amenity` | `post_box` |

### Viewpoint

| OSM key | OSM value |
|---|---|
| `tourism` | `viewpoint` |
| `tourism` | `attraction` |
| `tourism` | `museum` |
| `historic` | `castle` |
| `historic` | `monument` |
| `historic` | `memorial` |
| `historic` | `ruins` |

### Tourist info

| OSM key | OSM value |
|---|---|
| `tourism` | `information` |
| `information` | `office` |

### Charging

| OSM key | OSM value |
|---|---|
| `amenity` | `charging_station` |
| `amenity` | `device_charging_station` |

For e-bike batteries and device charging.

### Picnic

| OSM key | OSM value |
|---|---|
| `tourism` | `picnic_site` |
| `leisure` | `picnic_table` |
| `amenity` | `bbq` |

### Wifi

| OSM key | OSM value |
|---|---|
| `amenity` | `internet_cafe` |
| `internet_access` | `wlan` |
| `amenity` | `library` |

Libraries often provide free wifi and power outlets.

## Category colors

| Category | Color | Background |
|---|---|---|
| Water | `#0066CC` | Blue |
| Sleeping place | `#1A1A2E` | Dark navy |
| Restroom | `#FFD700` | Gold |
| Shelter | `#444444` | Dark gray |
| Food shop | `#228B22` | Forest green |
| Restaurant or Bar | `#FF6B35` | Orange |
| Gears | `#CC0000` | Red |
| DIY | `#E65100` | Deep orange |
| Laundry | `#FFB6C1` | Light pink |
| Medical | `#DC2626` | Red |
| Pharmacy | `#16A34A` | Green |
| Bank & ATM | `#1D4ED8` | Blue |
| Post office | `#CA8A04` | Amber |
| Viewpoint | `#7C3AED` | Purple |
| Tourist info | `#38BDF8` | Sky blue |
| Charging | `#FACC15` | Yellow |
| Picnic | `#059669` | Emerald |
| Wifi | `#6366F1` | Indigo |

## Corridor and filtering

- **Overpass radius**: 1000m around the simplified trace
- **Post-filter cutoff**: 1500m perpendicular distance to nearest trace segment
- **Deduplication**: 50m radius, same category, keeps the POI with most OSM tags

## Adding a new category

1. Add the category name to `PoiCategory` type in `types/index.ts`
2. Add the config entry to `POI_CATEGORIES` in `lib/poi-config.ts` (set `defaultEnabled: true` or `false`)
3. Add OsmAnd mappings in `OSMAND_CATEGORY_ICONS`, `OSMAND_CATEGORY_COLORS`, `OSMAND_CATEGORY_BACKGROUNDS`
4. Specify OSM tag matchers, icon, and style colors
5. Rebuild and test

No server changes needed – all matching happens client-side.
