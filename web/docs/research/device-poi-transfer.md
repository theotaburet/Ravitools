# Getting POIs onto GPS units and watches

Research of 2026-10-18. Question: which file, field and path actually puts a Ravitools POI on each device, and where does it get dropped?

## Summary

| Device | Path | What carries a POI | Limits and traps | Ravitools today |
|---|---|---|---|---|
| COROS (watches, DURA) | GPX opened with the COROS app, then "Sync with your device" | GPX `<wpt>`: kept as route waypoints, editable in the app | DURA: keep routes under 2,000 km, 100 MB and **fewer than 200 waypoints**. The watch shows the next waypoint's name, distance and climb left, and a "Sections" preview | GPX export has `<wpt>`: should work up to 200 POIs. Untested on hardware |
| Garmin | FIT course (Connect or USB) | `course_point` with a typed enum (water 3, food 4, first aid 9, campsite 27, rest area 29, service 31, shelter 36, overlook 38, toilet 39, gear 41, store 48, info 53) | Up Ahead shows about 15 characters. Garmin Explore course points with a custom icon are written as type 0 (generic) with the icon in an undocumented field | `export/fit.ts` writes typed course points; the mapping matches the official FIT SDK enum (checked against `@garmin/fitsdk` `profile.js`) |
| Wahoo (ACE, BOLT 3, ROAM 3) | FIT, GPX or TCX through the Wahoo app (cloud), or sync from Strava, Komoot, RWGPS | "Custom waypoints": name and description carry over; an unknown icon shows as generic | Routes imported through the Wahoo app get no matching custom icons. Users report off-track GPX waypoints become separate POIs, not cues | FIT and GPX exports; icon mapping not possible through file import |
| Hammerhead Karoo | Dashboard GPX import, or RWGPS sync | GPX `<wpt>` **only if** `<type>` and `<sym>` are both one of 9 case-sensitive values: `Food`, `Water`, `Parking`, `Camping`, `Lodging`, `Geocache`, `Summit`, `Generic`, `Danger`. Anything else is silently dropped | Officially, GPX imports show no POIs; the 9 values come from a community fixer (June 2026) | GPX export writes `<type>` = category name and `<sym>` = Garmin symbol (`Drinking Water`, ...): **every POI is dropped** |
| OsmAnd | OsmAnd GPX | `<wpt>` with OsmAnd extensions (icon, colour, background) | - | Dedicated export |

## Findings that change the code or the docs

1. **AGENTS.md is wrong about COROS.** It says "COROS DURA cannot ingest custom POIs". COROS's help center (article updated 2026-10-12) says waypoints in an imported route are displayed in the app and synced to the watch; the DURA article (2026-10-09) sizes routes at fewer than 200 waypoints. The project memory already says COROS reads GPX waypoints through its app.
2. **COROS needs a cap.** A 300 km route easily yields several hundred POIs. Above 200, an export for COROS should keep the most useful ones (water and food first, then by distance to the trace) and say so.
3. **Karoo drops all our GPX POIs.** A Karoo-friendly `<type>`/`<sym>` pair per family fixes it, but Karoo's `<sym>` values clash with Garmin's symbol names (`Water` versus `Drinking Water`). Options: a Karoo export variant, or Karoo values in `<type>` plus Garmin values in `<sym>` (does not work: Karoo wants both).
4. **Wahoo icons only come through route-provider sync.** A file import keeps names, not icons. Nothing to do on our side short of becoming a provider.

## Unofficial APIs

- COROS Training Hub runs on `teamapi.coros.com` (regional hosts for the EU and China). [Pinta365/coros](https://github.com/Pinta365/coros) (MIT) wraps login, activities and activity upload. Upload depends on two opaque signature values lifted from COROS's own clients, plus region-bound S3 buckets: an EU account uploading to the US bucket fails silently. No route import endpoint is documented there.
- COROS's partner API lists `route/push` (GPX or KML, 50 MB) for approved partners only.

## Reverse track: next steps, cheapest first

1. **Device test, no reverse needed** (needs the user and their COROS): import a Ravitools GPX with 250 waypoints, then check the count kept, name truncation, icons, and whether off-track POIs are snapped or dropped.
2. **HAR** of a route import in Training Hub, if the web exposes one: that would let Ravitools push a route with its POIs to the COROS account directly, with no file juggling on the phone.
3. **APK with JADX** (installed): find how the app parses `<wpt>` (fields read, icon mapping from `<sym>` or `<type>`, limits). REA needs Node 22, 24 or 26 to register; Homebrew's `node@24` install stopped silently twice here.

## Sources

- [COROS: Using Pins and Waypoints](https://support.coros.com/hc/en-us/articles/360055691511-Using-Pins-and-Waypoints), [Downloading and Syncing Routes to DURA](https://support.coros.com/hc/en-us/articles/26895703330196-Downloading-and-Syncing-Routes-to-DURA), [Troubleshooting GPX Route Imports](https://support.coros.com/hc/en-us/articles/360040243352-Troubleshooting-GPX-Route-Imports-for-Breadcrumb-Navigation) (read through the Zendesk API, the pages answer 403)
- [COROS Cycling: Navigating with DURA](https://coros.com/stories/coros-coaches/c/navigating-with-dura), [DC Rainmaker: COROS waypoint navigation (2021)](https://www.dcrainmaker.com/2021/01/update-waypoint-navigation.html)
- [Garmin FIT SDK, `profile.js`](https://cdn.jsdelivr.net/npm/@garmin/fitsdk/src/profile.js), [CoursePointer](https://docs.rs/coursepointer), [Garmin forum: Explore course point icons](https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-explore-ios/389520/4-0-1-coursepoints-cue-points-get-messed-up-if-you-edit-them-using-4-0-1/1860029)
- [Wahoo: Custom Waypoints and POIs](https://support.wahoofitness.com/hc/en-us/articles/30255756674194), [Wahoo: import a FIT, GPX or TCX route](https://support.wahoofitness.com/hc/en-us/articles/25936827245970), [Wahoo forum: ELEMNT GPX waypoints](https://wahoox.forum.wahoofitness.com/t/elemnt-gpx-waypoints/31369)
- [Hammerhead: POIs on routes](https://support.hammerhead.io/hc/en-us/articles/360036632794), [Feature request: POI import by any GPX](https://support.hammerhead.io/hc/en-us/community/posts/360038374193), [mendalka/gpx-poi-karoo-fixer](https://github.com/mendalka/gpx-poi-karoo-fixer)
- [Pinta365/coros](https://github.com/Pinta365/coros), [CuberL/coros-mcp](https://github.com/CuberL/coros-mcp)
