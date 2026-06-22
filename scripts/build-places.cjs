#!/usr/bin/env node
/*
 * Build public/places.jsonl — Singapore landmarks (schools, hospitals, parks,
 * tourist attractions) with a coordinate, for offline landmark search.
 * Source: OpenStreetMap via Overpass, fetched ONCE at build time.
 *
 *   node scripts/build-places.cjs
 *
 * Output (one JSON object per line):
 *   {"name":"Singapore Zoo","kind":"attraction","lat":1.4043,"lon":103.7930}
 */
const fs = require("fs");
const path = require("path");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter"
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BBOX = "1.15,103.55,1.48,104.1"; // Singapore
const OUT = path.join(__dirname, "..", "public", "places.jsonl");

const QUERY = `
[out:json][timeout:180];
(
  nwr["amenity"~"^(school|university|college|hospital)$"]["name"](${BBOX});
  nwr["leisure"~"^(park|nature_reserve)$"]["name"](${BBOX});
  nwr["tourism"~"^(attraction|museum|theme_park|zoo|gallery|viewpoint)$"]["name"](${BBOX});
);
out tags center;
`.trim();

function kindOf(tags) {
  const a = tags.amenity, l = tags.leisure, t = tags.tourism;
  if (a === "hospital") return "hospital";
  if (a === "school" || a === "university" || a === "college") return "school";
  if (l === "park" || l === "nature_reserve") return "park";
  if (t) return "attraction";
  return null;
}

async function fetchOverpass() {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        process.stdout.write(`Querying ${ep} (attempt ${attempt + 1}) ...\n`);
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "sg-nearby-bus-stops/1.0 (places index build script)"
          },
          body: "data=" + encodeURIComponent(QUERY)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.json();
      } catch (e) {
        console.warn(`  failed: ${e.message}`);
        lastErr = e;
        await sleep(3000);
      }
    }
  }
  throw lastErr;
}

async function main() {
  const data = await fetchOverpass();
  const elements = Array.isArray(data.elements) ? data.elements : [];
  console.log(`Got ${elements.length} landmark elements`);

  const byKey = new Map();
  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name;
    const kind = kindOf(tags);
    const c = el.center || (typeof el.lat === "number" ? { lat: el.lat, lon: el.lon } : null);
    if (!name || !kind || !c || typeof c.lat !== "number" || typeof c.lon !== "number") continue;
    const key = name + "|" + kind;
    if (!byKey.has(key)) byKey.set(key, { name, kind, lat: c.lat, lon: c.lon });
  }

  const places = [...byKey.values()]
    .map(p => ({ name: p.name, kind: p.kind, lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = places.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
  const jsonl = places.map(p => JSON.stringify(p)).join("\n") + "\n";
  fs.writeFileSync(OUT, jsonl);
  console.log(`Wrote ${places.length} landmarks to ${OUT}`, counts);
}

main().catch(err => {
  console.error("Places refresh failed:", err.message);
  if (fs.existsSync(OUT)) {
    console.warn(`Keeping existing ${path.basename(OUT)} (not refreshed this run).`);
    process.exit(0);
  }
  process.exit(1);
});
