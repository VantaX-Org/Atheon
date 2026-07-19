// Guard: the service worker must never precache HTML. A precached index.html
// outlives a deploy and points at hashed assets the server has purged — blank
// page until the user clears site data. Regression here shipped once (July
// 2026); this check makes the build fail instead of prod.
import { readFileSync } from "node:fs";

const sw = readFileSync(new URL("../dist/sw.js", import.meta.url), "utf8");
if (/\.html/.test(sw)) {
  console.error("FATAL: dist/sw.js references .html — the SW must never precache HTML.");
  console.error("Check workbox.globPatterns in vite.config.ts (html must stay absent).");
  process.exit(1);
}
console.log("sw-precache check OK: no HTML in service worker.");
