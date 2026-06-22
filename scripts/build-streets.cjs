#!/usr/bin/env node
/*
 * Build public/streets.jsonl — every named road in Singapore with a representative
 * coordinate, for fully-offline street search.
 *
 * Source: OpenStreetMap via Overpass (fetched ONCE at build time, then bundled —
 * no live API at runtime). Run occasionally to refresh:
 *   node scripts/build-streets.cjs
 *
 * Output (one JSON object per line):
 *   {"name":"Orchard Road","lat":1.3039,"lon":103.8318}
 */
const fs = require("fs");
const path = require("path");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BBOX = "1.15,103.55,1.48,104.1"; // Singapore
const OUT = path.join(__dirname, "..", "public", "streets.jsonl");

const QUERY = `
[out:json][timeout:300];
way["highway"]["name"](${BBOX});
out tags center;
`.trim();

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
            "User-Agent": "sg-nearby-bus-stops/1.0 (street index build script)"
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
  console.log(`Got ${elements.length} road segments`);

  // Group segments by name; average their centre points
  const byName = new Map();
  for (const el of elements) {
    const name = el.tags && el.tags.name;
    const c = el.center || (typeof el.lat === "number" ? { lat: el.lat, lon: el.lon } : null);
    if (!name || !c || typeof c.lat !== "number" || typeof c.lon !== "number") continue;
    if (!byName.has(name)) byName.set(name, { latSum: 0, lonSum: 0, n: 0 });
    const g = byName.get(name);
    g.latSum += c.lat; g.lonSum += c.lon; g.n += 1;
  }

  const streets = [...byName.entries()]
    .map(([name, g]) => ({
      name,
      lat: Number((g.latSum / g.n).toFixed(6)),
      lon: Number((g.lonSum / g.n).toFixed(6))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const jsonl = streets.map(s => JSON.stringify(s)).join("\n") + "\n";
  fs.writeFileSync(OUT, jsonl);
  console.log(`Wrote ${streets.length} unique roads to ${OUT}`);
}

main().catch(err => {
  console.error("Street refresh failed:", err.message);
  // Don't break the build over a transient Overpass hiccup: keep the existing
  // streets.jsonl if we have one; only fail hard when there is nothing to ship.
  if (fs.existsSync(OUT)) {
    console.warn(`Keeping existing ${path.basename(OUT)} (not refreshed this run).`);
    process.exit(0);
  }
  process.exit(1);
});
