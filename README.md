<img src="assets/icon.svg" width="64" height="64" alt="">

# tiny-paris

An isometric tiny north-east Paris (Montmartre, Gare du Nord, the canals,
Buttes-Chaumont, Belleville, Père-Lachaise) drawn in code on a canvas from
OpenStreetMap data, with cars, buses and the elevated métro line 2. Inspired by the maps collected on
[isocities](https://isocities.agenturl.dev/).

```sh
npm install
npm run dev        # http://localhost:5173
npm run data       # re-fetch OSM data into public/data/paris.json and paris.bin
npm run build
```

Drag to pan, scroll or pinch to zoom, +/− to zoom, H for the whole map, N to
hide place names, W to wander, click a building for details.

## Tests

```sh
npm run typecheck  # the app and api/
npm test           # unit tests (Vitest): data file, landmarks, métro shapes, report API
npm run build && npm run test:e2e   # smoke tests in Chrome (Playwright), desktop and phone
```

GitHub Actions runs all of them on every push and pull request
(`.github/workflows/ci.yml`).

Map data © OpenStreetMap contributors, ODbL.
