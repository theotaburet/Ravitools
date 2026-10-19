# POI Categories & OSM Tags

This document lists all 18 POI categories, their OSM tag matchers, and design rationale.

## Source of truth

The category definitions live in `web/client/src/lib/poi-config.ts`.

## Essential categories (enabled by default)

### Water

**Priority: critical**: most important for bikepacking.

| OSM key | OSM value | Notes |
|---|---|---|
| `amenity` | `water_point` | Dedicated water filling station |
| `amenity` | `drinking_water` | Public drinking water fountain |
| `man_made` | `water_tap` | Tap (cemeteries, villages); left out when `drinking_water=no` |
| `natural` | `spring` | Potability often unknown; left out when `drinking_water=no` |
| `amenity` | `fountain` | Only with `drinking_water=yes` (most fountains are decorative) |

### Sleeping place

**Priority: critical**: second most important after water.

| OSM key | OSM value | Notes |
|---|---|---|
| `tourism` | `camp_site` | Primary target for bikepackers |
| `tourism` | `hostel` | Budget indoor option |
| `tourism` | `alpine_hut` | Mountain shelter with beds |
| `tourism` | `chalet` | Rental cabin |
| `tourism` | `guest_house` | B&B style |
| `tourism` | `motel` | Roadside accommodation |
| `tourism` | `hotel` | Last resort, usually expensive |
| `tourism` | `wilderness_hut` | Unstaffed hut, free |

### Restroom

| OSM key | OSM value |
|---|---|
| `amenity` | `toilets` |
| `amenity` | `shower` |

### Shelter

| OSM key | OSM value |
|---|---|
| `amenity` | `shelter` |

Picnic, weather and rock shelters, lean-tos, huts. Bus shelters (`shelter_type=public_transport`), changing rooms and livestock field shelters are skipped: nobody plans to wait out a storm at a bus stop.

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
| `shop` | `kiosk` | |
| `amenity` | `marketplace` | |
| `amenity` | `fuel` | Fuel stations sell water and food, often late |
| `amenity` | `vending_machine` | Only with `vending` drinks, water, food, sweets, bread, milk or coffee (not parking meters) |

29 food shop types covering European diversity, plus markets, fuel stations and food or drink vending machines.

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

## Optional categories (off by default)

Every category is queried; the filter only hides. Turning one on shows its POIs at once.

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

## Colors

A category takes its family's color (`FAMILY_COLORS` in `lib/poi-config.ts`, `web/docs/design.md` 3.4), in the palette the user picked: the map, the list and the exports (KML, KMZ, OsmAnd GPX through `categoryColor`) show the same one. The glyph tells the categories of a family apart.

## Corridor and filtering

- **Overpass radius**: 1500 m around the simplified trace (`CORRIDOR_M`), every category
- **Post-filter cutoff**: the distance slider, 300 m to 1500 m (the query radius), perpendicular distance to the nearest trace segment
- **Deduplication**: 50 m radius, same mergeable category, keeps the POI with most OSM tags; it no longer grows with POI density (the map's count bubbles handle that)
- **Conditional tags**: a tag with `only` (vending machines, fountains) gets its own Overpass clause carrying the condition

## Adding a new category

1. Add the category name to `PoiCategory` type in `types/index.ts`
2. Add one row to `POI_CATEGORIES` in `lib/poi-config.ts`: OSM tag matchers, `defaultEnabled`, family, glyph, emoji, enrichment policy, dedup merge, GPX symbol, FIT course point type, OsmAnd icon and background (the type requires every field)
3. Add the fr label in `lib/i18n.ts`; an `ENRICHMENT_CONTRACTS` entry only for a `full` category
4. `just check`, then test on an example GPX

No server changes needed: all matching happens client-side.
