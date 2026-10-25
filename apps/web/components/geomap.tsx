'use client';
import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '@/lib/api';

export type Pin = { id: string; lat: number; lng: number; color: string; title: string; sub?: string; pulse?: boolean; big?: boolean };
type Cfg = { map: { styleUrl: string | null; tileUrl: string; attribution: string; center: [number, number]; zoom: number } };
let cfgP: Promise<Cfg> | null = null;
const getCfg = () => (cfgP ||= api<Cfg>('/config'));

/**
 * MapLibre GL over OSM raster tiles by default. Set MAP_STYLE_URL (vector style JSON, e.g. MapTiler/Stadia)
 * or MAP_TILE_URL on the API at runtime to switch providers — no rebuild needed. See README → Maps.
 */
export function GeoMap({ pins, onPick, mini, fit = true, children, circle, focus }: {
  pins: Pin[]; onPick?: (id: string) => void; mini?: boolean; fit?: boolean; children?: React.ReactNode;
  /** Shaded radius ring (km) around a point; when set, the view fits the ring instead of the pins. */
  circle?: { lat: number; lng: number; km: number; color?: string };
  /** Fly to a point (change `n` to re-trigger). */
  focus?: { lat: number; lng: number; n: number };
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const lib = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const pick = useRef(onPick); pick.current = onPick;

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [ml, cfg] = await Promise.all([import('maplibre-gl'), getCfg()]);
        if (dead || !el.current) return;
        lib.current = ml;
        try { ml.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs`); } catch { /* already set */ }
        const style: any = cfg.map.styleUrl || {
          version: 8,
          sources: { base: { type: 'raster', tiles: [cfg.map.tileUrl], tileSize: 256, attribution: cfg.map.attribution, maxzoom: 19 } },
          layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-saturation': -0.35, 'raster-contrast': -0.05 } }],
        };
        const m = new ml.Map({ container: el.current, style, center: cfg.map.center as any, zoom: mini ? 11 : cfg.map.zoom, attributionControl: { compact: true } as any, cooperativeGestures: !!mini } as any);
        m.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
        m.on('load', () => !dead && setReady(true));
        m.on('error', (e: any) => console.warn('map', e?.error?.message));
        map.current = m;
      } catch (e: any) { setErr(e?.message || 'Map failed to load'); }
    })();
    return () => { dead = true; markers.current.forEach((x) => x.remove()); map.current?.remove(); map.current = null; };
  }, [mini]);

  useEffect(() => {
    const m = map.current, ml = lib.current;
    if (!m || !ml || !ready) return;
    markers.current.forEach((x) => x.remove()); markers.current = [];
    const bounds = new ml.LngLatBounds();
    pins.forEach((p) => {
      const d = document.createElement('div');
      d.className = `mk ${p.pulse ? 'on' : ''} ${p.big ? 'big' : ''}`; d.style.background = p.color; d.title = p.title;
      d.addEventListener('click', (ev) => { ev.stopPropagation(); pick.current?.(p.id); });
      const mk = new ml.Marker({ element: d }).setLngLat([p.lng, p.lat]).addTo(m);
      if (!pick.current) mk.setPopup(new ml.Popup({ offset: 12, closeButton: false }).setHTML(`<b>${esc(p.title)}</b>${p.sub ? `<br/><span style="color:#64748b">${esc(p.sub)}</span>` : ''}`));
      markers.current.push(mk); bounds.extend([p.lng, p.lat]);
    });
    if (circle) return;
    if (fit && pins.length > 1) m.fitBounds(bounds, { padding: 50, maxZoom: 12, duration: 400 });
    else if (pins.length === 1) m.jumpTo({ center: [pins[0].lng, pins[0].lat], zoom: mini ? 12 : 11 });
  }, [pins, ready, fit, mini, circle]);

  const ck = circle ? `${circle.lat},${circle.lng},${circle.km},${circle.color || ''}` : '';
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const clear = () => { ['radius-fill', 'radius-line'].forEach((l) => m.getLayer(l) && m.removeLayer(l)); m.getSource('radius') && m.removeSource('radius'); };
    clear();
    if (!circle) return;
    const ring = ringCoords(circle.lat, circle.lng, circle.km);
    const color = circle.color || '#2563eb';
    m.addSource('radius', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } });
    m.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': color, 'fill-opacity': 0.08 } });
    m.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': color, 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });
    const lngs = ring.map((c) => c[0]), lats = ring.map((c) => c[1]);
    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 28, duration: 400 });
    return () => { try { clear(); } catch { /* map gone */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ck, ready]);

  useEffect(() => { if (focus && map.current && ready) map.current.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.current.getZoom(), 14), duration: 600 }); }, [focus?.n, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`mapbox ${mini ? 'mini' : ''}`}>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {!ready && !err && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}>Loading map…</div>}
      {err && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--rose)', fontSize: 13 }}>{err}</div>}
      {children}
    </div>
  );
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** 64-point polygon approximating a circle of `km` around lat/lng. */
function ringCoords(lat: number, lng: number, km: number): [number, number][] {
  const out: [number, number][] = [];
  const dLat = km / 110.574, dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) { const t = (i / 64) * 2 * Math.PI; out.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]); }
  return out;
}
