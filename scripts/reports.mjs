// Lists visitors' reports (api/report.ts), newest first.
//   npm run reports            all of them
//   npm run reports -- 20      the latest 20
// Needs BLOB_READ_WRITE_TOKEN from .env.local (`vercel env pull` writes it).

import { get, list } from "@vercel/blob";

const limit = Number(process.argv[2]) || Infinity;
const blobs = [];
for (let cursor; ; ) {
  const page = await list({ prefix: "reports/", cursor });
  blobs.push(...page.blobs);
  if (!page.hasMore) break;
  cursor = page.cursor;
}
blobs.sort((a, b) => b.uploadedAt - a.uploadedAt);

const KIND = { "looks-wrong": "looks wrong", "wrong-place": "wrong place", missing: "missing", other: "other" };
for (const b of blobs.slice(0, limit)) {
  const res = await get(b.pathname, { access: "private" });
  const r = JSON.parse(await new Response(res.stream).text());
  const where = r.lon != null ? `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=19/${r.lat}/${r.lon}` : "";
  console.log(`${r.at.slice(0, 16).replace("T", " ")}  ${KIND[r.kind] ?? r.kind}  ${r.building ?? "(the view)"}  ${r.country ?? ""}`);
  if (r.note) console.log(`    ${r.note.replace(/\n/g, "\n    ")}`);
  if (where) console.log(`    ${where}`);
}
console.log(`\n${blobs.length} report${blobs.length === 1 ? "" : "s"}`);
