// Copies MapLibre's ESM worker into /public so the browser can load it same-origin (see geomap.tsx setWorkerUrl).
const fs = require('fs'); const path = require('path');
// maplibre-gl's "exports" hides subpaths, so walk node_modules dirs (workspace-hoisted or local).
const roots = require.resolve.paths('maplibre-gl') || [];
const dir = roots.map((r) => path.join(r, 'maplibre-gl')).find((d) => fs.existsSync(path.join(d, 'dist', 'maplibre-gl-worker.mjs')));
if (!dir) { console.error('maplibre-gl not installed'); process.exit(1); }
const src = path.join(dir, 'dist', 'maplibre-gl-worker.mjs');
fs.mkdirSync(path.join(__dirname, 'public', 'maplibre'), { recursive: true });
fs.copyFileSync(src, path.join(__dirname, 'public', 'maplibre', 'maplibre-gl-worker.mjs'));
console.log('maplibre worker copied from', src);
