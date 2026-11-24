import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

/** A short hash of everything in a folder of public/: it changes only when a file in it does. */
function hashOf(dir: string) {
  const hash = createHash("sha1");
  for (const f of readdirSync(`public/${dir}`, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${e.parentPath}/${e.name}`).sort()) {
    hash.update(f).update(readFileSync(f));
  }
  return hash.digest("hex").slice(0, 10);
}

// The map's data, painted tiles and sprites keep their file names, so the app
// asks for them with their folder's hash (`?v=…`, see src/assets.ts) and
// vercel.json lets browsers keep those for good. Not in dev: they'd be hashed
// on every start, and nothing is cached there anyway.
export default defineConfig(({ command }) => ({
  define: {
    __ASSETS__: JSON.stringify(command === "build" ? Object.fromEntries(["data", "painted", "sprites", "thumbs"].map((d) => [d, hashOf(d)])) : {}),
  },
  test: { include: ["tests/unit/**/*.test.ts"], testTimeout: 60_000 },
}));
