/** Abia State LGAs with approximate centroids (lat, lng) — used for demo coordinates and map framing. */
export const LGA_GEO: Record<string, [number, number]> = {
  'Aba North': [5.1290, 7.3720], 'Aba South': [5.0960, 7.3560], 'Arochukwu': [5.3880, 7.9110], 'Bende': [5.5600, 7.6360],
  'Ikwuano': [5.4300, 7.5800], 'Isiala Ngwa North': [5.3700, 7.4000], 'Isiala Ngwa South': [5.2800, 7.4000], 'Isuikwuato': [5.7600, 7.4800],
  'Obi Ngwa': [5.1500, 7.4500], 'Ohafia': [5.6200, 7.8300], 'Osisioma': [5.1500, 7.3300], 'Ugwunagbo': [5.0300, 7.3200],
  'Ukwa East': [4.9000, 7.3700], 'Ukwa West': [4.9500, 7.2500], 'Umuahia North': [5.5400, 7.4900], 'Umuahia South': [5.5000, 7.4700],
  'Umu Nneochi': [5.9800, 7.4200],
};
export const LGAS = Object.keys(LGA_GEO);
export const ABIA_CENTER: [number, number] = [5.42, 7.52];
export function normLga(v?: string | null): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase().replace(/\s+/g, ' ');
  return LGAS.find((l) => l.toLowerCase() === t) || LGAS.find((l) => l.toLowerCase().replace(/[\s-]/g, '') === t.replace(/[\s-]/g, '')) || null;
}
/** Jittered point inside an LGA (≈ ±3km). */
export function pointIn(lga: string, rnd: () => number = Math.random): [number, number] {
  const c = LGA_GEO[lga] || ABIA_CENTER;
  return [+(c[0] + (rnd() - 0.5) * 0.06).toFixed(6), +(c[1] + (rnd() - 0.5) * 0.06).toFixed(6)];
}
export const ONLINE_MS = () => Number(process.env.AGENT_ONLINE_MINUTES || 15) * 60000;
