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

// Minimal .env reader (avoids a dotenv dependency)
function readEnvKey(name) {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* no .env file */ }
  return undefined;
}

const KEY = process.argv[2] || process.env.LTA_ACCOUNT_KEY || readEnvKey("LTA_ACCOUNT_KEY");
if (!KEY || KEY === "your-account-key-here") {
  console.error("Missing AccountKey. Set LTA_ACCOUNT_KEY in .env (see .env.example),");
  console.error("or run: node scripts/build-stops.cjs <AccountKey>");
  process.exit(1);
}

const ENDPOINT = "https://datamall2.mytransport.sg/ltaodataservice/BusStops";
const OUT = path.join(__dirname, "..", "public", "bus-stops.jsonl");

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
