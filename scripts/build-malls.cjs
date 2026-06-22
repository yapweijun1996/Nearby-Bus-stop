#!/usr/bin/env node
/*
 * Build public/malls.jsonl - Singapore shopping malls with a coordinate, for
 * offline mall search. Source: OpenStreetMap via Overpass, fetched ONCE at build
 * time (no live API at runtime).
 *
 *   node scripts/build-malls.cjs
 *
 * Output (one JSON object per line):
 *   {"name":"VivoCity","lat":1.2643,"lon":103.8222}
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
const OUT = path.join(__dirname, "..", "public", "malls.jsonl");

const QUERY = `
[out:json][timeout:120];
(
  nwr["shop"="mall"]["name"](${BBOX});
  nwr["shop"="department_store"]["name"](${BBOX});
);
out tags center;
`.trim();

function toAsciiName(name, fallback) {
  return name
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([),.])/g, "$1")
    .trim() || fallback;
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
            "User-Agent": "sg-nearby-bus-stops/1.0 (mall index build script)"
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
  console.log(`Got ${elements.length} mall elements`);

  const byName = new Map();
  for (const el of elements) {
    const name = el.tags && el.tags.name;
    const c = el.center || (typeof el.lat === "number" ? { lat: el.lat, lon: el.lon } : null);
    if (!name || !c || typeof c.lat !== "number" || typeof c.lon !== "number") continue;
    if (!byName.has(name)) byName.set(name, { lat: c.lat, lon: c.lon });
  }

  const malls = [...byName.entries()]
    .map(([name, c]) => ({ name: toAsciiName(name, "Unnamed mall"), lat: Number(c.lat.toFixed(6)), lon: Number(c.lon.toFixed(6)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const jsonl = malls.map(m => JSON.stringify(m)).join("\n") + "\n";
  fs.writeFileSync(OUT, jsonl);
  console.log(`Wrote ${malls.length} malls to ${OUT}`);
}

main().catch(err => {
  console.error("Mall refresh failed:", err.message);
  if (fs.existsSync(OUT)) {
    console.warn(`Keeping existing ${path.basename(OUT)} (not refreshed this run).`);
    process.exit(0);
  }
  process.exit(1);
});
