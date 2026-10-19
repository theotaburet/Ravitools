# Similar tools: POIs along a route

Research of 2026-10-18. Question: who else finds water, food and shelter along a GPX, and what do they teach Ravitools?

## Landscape

| Tool | What it does | Strength | Limit |
|---|---|---|---|
| [NearSpotio](https://chrome-stats.com/d/app.nearspotio) (Android) | Imports a GPX, shows water, toilets, bakeries, shops and bike repair along it | 3.3 million OSM POIs stored on the phone: works offline | Phone only; export to bike computers is claimed by the developer, not verified |
| [routecheck.cc](https://www.cyclechat.net/threads/routecheck-cc-find-pois-along-a-route.222413/) | Upload a GPX, click the POIs along it | No account | Manual picking |
| [AquaTrace](https://www.utagawavtt.com/forum_v3/viewtopic.php?p=128672) | Drinking water near a GPX, from OSM | **Strict**: only `amenity=drinking_water`; toilets only with `drinking_water=yes` | Europe only, water only, export unclear |
| GPX Edit ([thread](https://www.randonner-leger.org/forum/viewtopic.php?pid=743481)) | OSM water points on a trace | - | Counts `amenity=toilets` as water: noise |
| [cycle.travel](https://cycle.travel/post/6057) | Route planner, markers in the downloaded GPX | Planning and POIs in one place | Some apps ignore its markers |
| [Ride with GPS](https://bikerumor.com/ridewithgps-waypoints-cycling-route-map-feature/) | Manual waypoints with icons (water, food, camping) while planning | Syncs POIs to Garmin, Wahoo, Hammerhead and COROS through accounts | No search along the route; you place each point |
| Strava, Komoot | OSM-based POIs (toilets, fountains) and highlights | Free; sync waypoints to Wahoo | Not route-filtered, no export of the selection |
| COROS route builder | Waypoints for water, bathrooms, resupply, campsites | Native on COROS devices | Manual |
| DIY | Overpass, then GPSBabel's arc filter to keep waypoints within N m of the track ([thread](https://community.openstreetmap.org/t/find-drinking-water-amenities-on-a-gpx-track/8091)), or a [Python tutorial](https://github.com/Andrewwango/gpx-overpass-googlemaps-tutorial) | Free, exact | Command line; no distance along the route |
| [gpx-poi-karoo-app](https://mendalka.github.io/gpx-poi-karoo-app/) | Rewrites GPX waypoints so Karoo keeps them | Runs in the browser, private | A fixer, not a finder |

## Where Ravitools stands

What no single tool above combines: an `around:` corridor plus perpendicular distance (low noise), 18 categories, multi-GPX, enrichment with provenance, exports tuned per device, and the GPX never leaving the browser. The closest competitor on finding is NearSpotio (offline, phone); on delivery it is Ride with GPS (account sync to every brand).

## Lessons for Ravitools

1. **Delivery is the gap, not finding.** RWGPS and Komoot win because POIs reach the device through account sync. For us, the cheap win is per-device export correctness (see `device-poi-transfer.md`): the COROS 200-waypoint cap and Karoo's 9 types.
2. **Water must stay strict, and could be wider.** AquaTrace's users ask for strictness (toilets are not water unless tagged). Ravitools queries only `amenity=drinking_water` and `amenity=water_point`; it misses taps, fountains and springs tagged `drinking_water=yes` (`man_made=water_tap`, `amenity=fountain`, `natural=spring`), and toilets with `drinking_water=yes`. That needs a secondary-tag filter in the query builder: worth an experiment on the example GPX files (gain in water points, noise).
3. **Offline matters.** NearSpotio's selling point is offline lookup on the ride. Ride mode is out of scope for designV2 but belongs in its own spec.
4. **Silent drops are the common failure.** Karoo, Wahoo icons, COROS above 200: devices drop POIs without saying so. An export should say what each target will keep.
