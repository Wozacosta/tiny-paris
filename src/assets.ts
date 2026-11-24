// The big files in public/ (map data, painted tiles, sprites) are asked for
// with a hash of their folder's contents, worked out at build time
// (vite.config.ts). A URL with `?v=` never changes what it means, so
// vercel.json tells browsers to keep it for a year; when a tile is repainted
// or the data refreshed, the hash and so the URLs change.

declare const __ASSETS__: Record<string, string> | undefined;

/** `/painted/0/1_2.webp` → `/painted/0/1_2.webp?v=3f9c…` (unchanged in dev). */
export function asset(path: string) {
  const v = typeof __ASSETS__ === "undefined" ? undefined : __ASSETS__[path.split("/")[1]];
  return v ? `${path}?v=${v}` : path;
}
