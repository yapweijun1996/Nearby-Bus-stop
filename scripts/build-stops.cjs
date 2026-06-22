#!/usr/bin/env node
/*
 * Build bus-stops.jsonl from LTA DataMall (one-time / occasional refresh).
 *
 * Usage:
 *   node scripts/build-stops.cjs <LTA_DataMall_AccountKey>
 *   # or set the key in the environment:
 *   LTA_ACCOUNT_KEY=xxxx node scripts/build-stops.cjs
 *
 * Output: ./bus-stops.jsonl  (one JSON object per line)
 *   {"code":"07379","name":"Aperia/Before Kallang Road","road":"Kallang Road","lat":1.2821,"lon":103.8591}
 *
 * Notes:
 * - LTA DataMall returns 500 records per call; we page with $skip until empty.
 * - The API blocks browser CORS, which is exactly why we fetch it here (Node,
 *   build time) and ship a static file instead of calling it from the browser.
 * - Data licensed under the Singapore Open Data Licence.
 */
const fs = require("fs");
const path = require("path");

const KEY = process.argv[2] || process.env.LTA_ACCOUNT_KEY;
if (!KEY) {
  console.error("Missing AccountKey. Usage: node scripts/build-stops.cjs <AccountKey>");
  process.exit(1);
}

const ENDPOINT = "https://datamall2.mytransport.sg/ltaodataservice/BusStops";
const OUT = path.join(__dirname, "..", "bus-stops.jsonl");

async function main() {
  const stops = [];
  for (let skip = 0; ; skip += 500) {
    const res = await fetch(`${ENDPOINT}?$skip=${skip}`, {
      headers: { AccountKey: KEY, accept: "application/json" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} at skip=${skip}`);
    const json = await res.json();
    const batch = Array.isArray(json.value) ? json.value : [];
    if (batch.length === 0) break;
    for (const b of batch) {
      const lat = Number(b.Latitude);
      const lon = Number(b.Longitude);
      if (!b.BusStopCode || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      stops.push({
        code: String(b.BusStopCode),
        name: b.Description || b.RoadName || "Bus Stop",
        road: b.RoadName || "",
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6))
      });
    }
    process.stdout.write(`\rFetched ${stops.length} stops...`);
  }
  // De-duplicate by code (defensive)
  const byCode = new Map();
  for (const s of stops) byCode.set(s.code, s);
  const unique = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));

  const jsonl = unique.map(s => JSON.stringify(s)).join("\n") + "\n";
  fs.writeFileSync(OUT, jsonl);
  console.log(`\nWrote ${unique.length} stops to ${OUT}`);
}

main().catch(err => { console.error("\nFailed:", err.message); process.exit(1); });
