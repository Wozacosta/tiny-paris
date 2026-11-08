// Visitors' reports of things the map gets wrong, saved as private JSON files
// in the tiny-paris-reports Blob store. Read them with `node scripts/reports.mjs`.

import { put } from "@vercel/blob";

const KINDS = new Set(["looks-wrong", "wrong-place", "missing", "other"]);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null);

// A few reports per visitor per 10 minutes. Per instance only, which is enough
// to stop a script hammering the form; the Blob store isn't a database.
const recent = new Map<string, number[]>();
function tooMany(key: string) {
  const now = Date.now(), times = (recent.get(key) ?? []).filter((t) => now - t < 10 * 60e3);
  times.push(now);
  recent.set(key, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 5;
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 4000) return new Response("Too long", { status: 413 });
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  // Bots fill in every field; people never see this one.
  if (text(r.website, 10)) return new Response(null, { status: 204 });
  const kind = text(r.kind, 20), note = text(r.note, 1000);
  if (!KINDS.has(kind) || (kind === "other" && !note)) return new Response("Bad request", { status: 400 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
  if (tooMany(ip)) return new Response("Too many reports, try again later", { status: 429 });

  const at = new Date().toISOString();
  const report = {
    at,
    kind,
    note,
    building: text(r.building, 160) || null,
    lon: num(r.lon),
    lat: num(r.lat),
    zoom: num(r.zoom),
    country: request.headers.get("x-vercel-ip-country"),
  };
  await put(`reports/${at.slice(0, 10)}/${at.slice(11, 19).replaceAll(":", "")}.json`, JSON.stringify(report), {
    access: "private",
    addRandomSuffix: true,
    contentType: "application/json",
  });
  return new Response(null, { status: 204 });
}
