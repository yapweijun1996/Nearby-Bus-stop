#!/usr/bin/env node
/*
 * Build public/mrt.jsonl - Singapore MRT/LRT stations with a coordinate, for
 * offline station search. Source: OpenStreetMap via Overpass, fetched ONCE at
 * build time (no live API at runtime).
 *
 *   node scripts/build-mrt.cjs
 *
 * Output (one JSON object per line):
 *   {"name":"Jurong East","code":"NS1 EW24","lat":1.3334,"lon":103.7421}
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
const OUT = path.join(__dirname, "..", "public", "mrt.jsonl");

const QUERY = `
[out:json][timeout:120];
(
  nwr["railway"="station"]["station"="subway"]["name"](${BBOX});
  nwr["railway"="station"]["station"="light_rail"]["name"](${BBOX});
  nwr["railway"="station"]["subway"="yes"]["name"](${BBOX});
  nwr["railway"="station"]["light_rail"="yes"]["name"](${BBOX});
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
            "User-Agent": "sg-nearby-bus-stops/1.0 (mrt index build script)"
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

function cleanName(name) {
  // Normalise "Jurong East MRT Station" -> "Jurong East" for nicer display/search
  const shortName = name.replace(/\s+(MRT|LRT)\b.*$/i, "").trim() || name;
  return toAsciiName(shortName, "Unnamed station");
}

async function main() {
  const data = await fetchOverpass();
  const elements = Array.isArray(data.elements) ? data.elements : [];
  console.log(`Got ${elements.length} station elements`);

  const byName = new Map();
  for (const el of elements) {
    const raw = el.tags && el.tags.name;
    const c = el.center || (typeof el.lat === "number" ? { lat: el.lat, lon: el.lon } : null);
    if (!raw || !c || typeof c.lat !== "number" || typeof c.lon !== "number") continue;
    const name = cleanName(raw);
    const code = (el.tags.ref || "").trim();
    if (!byName.has(name)) byName.set(name, { lat: c.lat, lon: c.lon, code });
    else if (code && !byName.get(name).code) byName.get(name).code = code;
  }

  const stations = [...byName.entries()]
    .map(([name, v]) => {
      const o = { name, lat: Number(v.lat.toFixed(6)), lon: Number(v.lon.toFixed(6)) };
      if (v.code) o.code = v.code;
      return o;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const jsonl = stations.map(s => JSON.stringify(s)).join("\n") + "\n";
  fs.writeFileSync(OUT, jsonl);
  console.log(`Wrote ${stations.length} MRT/LRT stations to ${OUT}`);
}

main().catch(err => {
  console.error("MRT refresh failed:", err.message);
  if (fs.existsSync(OUT)) {
    console.warn(`Keeping existing ${path.basename(OUT)} (not refreshed this run).`);
    process.exit(0);
  }
  process.exit(1);
});
