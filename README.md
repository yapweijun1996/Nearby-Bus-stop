# SG Nearby Bus Stops

Find nearby Singapore bus stops on an interactive map. Vanilla JavaScript + Leaflet,
built with Vite, installable as a PWA, and able to run **fully offline** from a bundled
copy of the LTA bus-stop list.

**Live demo:** https://yapweijun1996.github.io/Nearby-Bus-stop/

<img width="512" height="512" alt="App icon" src="public/icons/icon-512.png" />

## Features

- **Locate me** - center the map on your position and list bus stops within the radius.
- **Nearby list** - every stop shows its LTA code, name, distance, and estimated walk
  time; tapping a row flies the map to that stop (or opens live arrival times on a watch).
- **Adjustable radius** - slider from 100 m to 2 km (default **200 m**).
- **Offline multi-search** - one search box matches bundled data in priority order:
  bus-stop **code**, **MRT/LRT** station (by code like `NS1` or name), **shopping mall**,
  **landmark**, **road name**, then bus-stop name - all locally. It only falls back to
  Overpass place geocoding when nothing matches.
- **Live arrival times** - each stop links to the arrival-time lookup (shown only for
  valid 5-digit LTA codes, so there are no dead links).
- **Works offline** - when `public/bus-stops.jsonl` is present, nearby lookups are local
  and instant with no API calls; a service worker caches the app shell.
- **Responsive** - tuned layouts for desktop, tablet, mobile, and Apple Watch / ultra-small
  screens (icon toolbar, list-first layout, tap-to-expand search).
- **Installable PWA** - manifest, icons, service worker, and an offline fallback page.
- **Shareable URLs** - open a specific point with `?lat=1.283&lon=103.860`.

## Data sources

| Purpose | Source |
| --- | --- |
| Nearby bus stops (primary) | Bundled `public/bus-stops.jsonl`, generated from [LTA DataMall](https://datamall.lta.gov.sg/) |
| Nearby bus stops (fallback) | [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (`highway=bus_stop`, `public_transport=platform`) |
| Street search (offline) | Bundled `public/streets.jsonl` - all named SG roads, generated from OpenStreetMap |
| Mall search (offline) | Bundled `public/malls.jsonl` - SG shopping malls, generated from OpenStreetMap |
| MRT/LRT search (offline) | Bundled `public/mrt.jsonl` - SG rail stations (by name or code), from OpenStreetMap |
| Landmark search (offline) | Bundled `public/places.jsonl` - SG schools, hospitals, parks, attractions, from OpenStreetMap |
| Place search (fallback) | Overpass API geocoding |
| Base map tiles | [OpenStreetMap](https://www.openstreetmap.org/) (default) - see **Map tiles** below |
| Map library | [Leaflet](https://leafletjs.com/) 1.9.4 (pinned, with SRI) |

If `bus-stops.jsonl` is missing, the app automatically falls back to live Overpass
queries - nothing breaks, it is just slower and subject to rate limits.

`bus-stops.jsonl` is one JSON object per line:

```jsonl
{"code":"07379","name":"Aperia/Before Kallang Road","road":"Kallang Road","lat":1.2821,"lon":103.8591}
```

## Map tiles

The default map uses free **OpenStreetMap** tiles, which under the
[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/) are for
**hobby / low-volume use only** - heavy or commercial use will be rate-limited or
blocked. For production or business use, switch to a paid tile provider (MapTiler,
Mapbox, Stadia Maps, Thunderforest, ...) via the `TILE_CONFIG` block near the top of the
inline script in [`index.html`](index.html):

```js
const TILE_CONFIG = {
  provider: 'custom',
  url: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY',
  attribution: '(c) <a href="https://www.maptiler.com/">MapTiler</a> (c) OpenStreetMap contributors',
  maxZoom: 19
};
```

Attribution for the map tiles and the LTA bus data (Singapore Open Data Licence) is shown
in the corner of the map and must stay visible.

## Project layout

```
index.html               App entry (HTML + inline CSS/JS), Vite entry point
public/                  Static assets copied verbatim into the build
  bus-stops.jsonl        Bundled SG bus-stop dataset (nearby + search)
  mrt.jsonl              Bundled MRT/LRT stations (search)
  malls.jsonl            Bundled shopping malls (search)
  streets.jsonl          Bundled named roads (search)
  places.jsonl           Bundled landmarks (search)
  manifest.webmanifest   PWA manifest
  service-worker.js      Offline caching (app shell + network-first datasets)
  offline.html           Offline fallback page
  icons/                 App icons
scripts/build-stops.cjs  Generates public/bus-stops.jsonl from LTA DataMall
scripts/build-streets.cjs Generates public/streets.jsonl from OpenStreetMap
scripts/build-malls.cjs  Generates public/malls.jsonl from OpenStreetMap
scripts/build-mrt.cjs    Generates public/mrt.jsonl from OpenStreetMap
vite.config.js           Vite config (base './' for the Pages sub-path)
```

## Develop & build

Requires Node 18+.

```bash
npm install            # one-time
npm run dev            # dev server with HMR (http://localhost:5173)
npm run build          # refresh all datasets (stops/streets/malls/mrt/places), then build to dist/
npm run build:pages    # build only, no data refresh (used by CI)
npm run preview        # serve the production build from dist/
```

## Refreshing the bus-stop data

The LTA bus-stop list changes rarely, so the dataset is refreshed manually (or whenever
you run `npm run build`). The DataMall key is used **locally only** and is never committed
or sent to the browser.

1. Get a free Account Key from
   [LTA DataMall](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html).
2. Copy `.env.example` to `.env` and set `LTA_ACCOUNT_KEY` (`.env` is gitignored):

   ```bash
   LTA_ACCOUNT_KEY=your-account-key-here
   ```

3. Refresh and commit:

   ```bash
   npm run data        # rewrites public/bus-stops.jsonl (or `npm run build` to also build)
   git add public/bus-stops.jsonl && git commit -m "Refresh bus-stop data"
   ```

Data is provided under the Singapore Open Data Licence.

### Refreshing the OpenStreetMap indexes

The street, mall, and MRT/LRT indexes are generated from OpenStreetMap (via Overpass,
fetched once at build time - no key, no runtime API):

```bash
npm run streets     # rewrites public/streets.jsonl (all named SG roads)
npm run malls       # rewrites public/malls.jsonl   (SG shopping malls)
npm run mrt         # rewrites public/mrt.jsonl      (SG MRT/LRT stations)
```

`npm run build` refreshes all of these automatically. If an Overpass fetch fails (it is a
shared, rate-limited service), the build keeps the existing file instead of breaking - so
a transient outage never blocks a build.

## Deployment (GitHub Pages)

[GitHub Actions](.github/workflows/deploy-pages.yml) builds with Vite and publishes the
`dist/` folder on every push to `main`/`master`.

1. In the repo, set **Settings -> Pages -> Source: GitHub Actions**.
2. Push your changes.
3. CI runs `npm ci` + `npm run build:pages` (no API key needed - it uses the committed
   `bus-stops.jsonl`) and deploys `dist/`.

## Install as an app (PWA)

- **iPhone/iPad** - open the site in Safari -> Share -> **Add to Home Screen**.
- **Android** - open in Chrome -> **Install app** / **Add to Home screen**.
- **Desktop** - Chrome/Edge -> install button in the address bar.
- Offline: the app shell and bundled stops work offline; live arrival times and place
  search still need a network connection.

## Privacy

Geolocation is used only in your browser to center the map and find nearby stops. Your
location is never stored or sent to any server.

## License

MIT - see [LICENSE](LICENSE).
