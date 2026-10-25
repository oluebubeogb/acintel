/* Illustrated duotone KPI icons — hand-built SVGs tinted from each card's accent (no clipart). */
type P = { c: string; c2: string };
const Doc = ({ c, c2 }: P) => (<>
  <path d="M15 9h13l8 8v22a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" fill="#fff" stroke={c} strokeWidth="2" />
  <path d="M28 9v6a2 2 0 0 0 2 2h6" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M17 24h12M17 29h9M17 34h6" stroke={c} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
  <circle cx="35" cy="35" r="7" fill={c} /><path d="M35 31.5v4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="35" cy="38.4" r="1.2" fill="#fff" />
</>);
const Truck = ({ c, c2 }: P) => (<>
  <path d="M6 15a2 2 0 0 1 2-2h19a2 2 0 0 1 2 2v17H6z" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M29 19h7l6 7v6H29z" fill="#fff" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M32 21.5h3.5l3.5 4H32z" fill={c} fillOpacity=".35" />
  <path d="M15 18v8M11 22h8" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
  <circle cx="13" cy="34" r="4" fill="#fff" stroke={c} strokeWidth="2.2" /><circle cx="35" cy="34" r="4" fill="#fff" stroke={c} strokeWidth="2.2" />
  <path d="M2 18h3M1 23h4" stroke={c} strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
</>);
const Checklist = ({ c, c2 }: P) => (<>
  <rect x="11" y="10" width="26" height="32" rx="3.5" fill="#fff" stroke={c} strokeWidth="2" />
  <rect x="18" y="6.5" width="12" height="7" rx="2.5" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M16 21l2.2 2.2L22 19.5M16 29l2.2 2.2L22 27.5" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  <path d="M25 22h7M25 30h7M16 36.5h16" stroke={c} strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
</>);
const Seal = ({ c, c2 }: P) => (<>
  <path d="M24 5l4.2 3.1 5.2-.3 1.6 5 4.3 3-1.7 4.9 1.7 4.9-4.3 3-1.6 5-5.2-.3L24 37.5l-4.2-3.2-5.2.3-1.6-5-4.3-3 1.7-4.9-1.7-4.9 4.3-3 1.6-5 5.2.3z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <circle cx="24" cy="21" r="8.5" fill="#fff" stroke={c} strokeWidth="1.6" />
  <path d="M20 21.2l2.8 2.8 5.4-5.6" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  <path d="M17 34l-3 9 4.5-1.6L21 45l2-8M31 34l3 9-4.5-1.6L27 45l-2-8" fill={c} fillOpacity=".8" />
</>);
const Agent = ({ c, c2 }: P) => (<>
  <path d="M24 5l15 5.5v10.5c0 9.6-6.4 17.6-15 20.5C15.4 38.6 9 30.6 9 21V10.5z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <circle cx="24" cy="18" r="5" fill="#fff" stroke={c} strokeWidth="2" />
  <path d="M15.5 33c1.6-4.6 4.8-7 8.5-7s6.9 2.4 8.5 7" fill="#fff" stroke={c} strokeWidth="2" strokeLinecap="round" />
  <circle cx="36.5" cy="36.5" r="6" fill="#22c55e" stroke="#fff" strokeWidth="2.4" />
</>);
const Suspended = ({ c, c2 }: P) => (<>
  <circle cx="19" cy="15" r="6" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M7 38c1.4-7.2 6-11.5 12-11.5 3.4 0 6.3 1.4 8.4 3.8" fill={c2} stroke={c} strokeWidth="2" strokeLinecap="round" />
  <circle cx="34" cy="33" r="9" fill="#fff" stroke={c} strokeWidth="2.4" />
  <path d="M27.8 39.2l12.4-12.4" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
</>);
const Pending = ({ c, c2 }: P) => (<>
  <circle cx="15" cy="16" r="5" fill="#fff" stroke={c} strokeOpacity=".6" strokeWidth="2" />
  <path d="M5 34c1-5.4 4.6-8.5 9.5-8.5" fill="none" stroke={c} strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />
  <circle cx="24" cy="14" r="6" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M12 37c1.4-7 6-11 12-11 2.6 0 4.9.8 6.8 2.2" fill={c2} stroke={c} strokeWidth="2" strokeLinecap="round" />
  <circle cx="35" cy="34" r="8.5" fill="#fff" stroke={c} strokeWidth="2.2" />
  <path d="M35 29.5V34l3 2" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
</>);
const Siren = ({ c, c2 }: P) => (<>
  <path d="M5 13l4 2.2M43 13l-4 2.2M24 3v4.5M11.5 6.5l2.6 3.4M36.5 6.5l-2.6 3.4" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
  <path d="M13 34V25a11 11 0 0 1 22 0v9z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M19 25a5 5 0 0 1 5-5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
  <rect x="8" y="34" width="32" height="7" rx="2.5" fill={c} />
  <circle cx="24" cy="29" r="2.6" fill={c} />
</>);
const Clock = ({ c, c2 }: P) => (<>
  <circle cx="24" cy="25" r="16" fill={c2} stroke={c} strokeWidth="2" />
  <circle cx="24" cy="25" r="11" fill="#fff" stroke={c} strokeOpacity=".4" strokeWidth="1.6" />
  <path d="M24 18v7.5l5 3" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  <path d="M19 5h10M24 5v4" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
</>);
const Users = ({ c, c2 }: P) => (<>
  <circle cx="32" cy="16" r="5" fill="#fff" stroke={c} strokeOpacity=".6" strokeWidth="2" />
  <path d="M43 35c-1-5.4-4.6-8.5-9.5-8.5" fill="none" stroke={c} strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />
  <circle cx="19" cy="15" r="6.5" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M6 39c1.4-7.6 6.4-12 13-12s11.6 4.4 13 12z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
</>);
const Chart = ({ c, c2 }: P) => (<>
  <rect x="7" y="7" width="34" height="34" rx="5" fill="#fff" stroke={c} strokeWidth="2" />
  <rect x="13" y="25" width="5" height="10" rx="1.5" fill={c2} stroke={c} strokeWidth="1.8" />
  <rect x="21.5" y="18" width="5" height="17" rx="1.5" fill={c} fillOpacity=".75" />
  <rect x="30" y="13" width="5" height="22" rx="1.5" fill={c2} stroke={c} strokeWidth="1.8" />
</>);
const SendI = ({ c, c2 }: P) => (<>
  <path d="M6 22.5L41 8l-9.5 33-8.2-11.6z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M23.3 29.4L41 8 14.5 26.5z" fill="#fff" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M23.3 29.4l-2.8 9.1 6.1-4.4" fill={c} fillOpacity=".55" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
</>);
const Headset = ({ c, c2 }: P) => (<>
  <path d="M10 26v-3a14 14 0 0 1 28 0v3" stroke={c} strokeWidth="2.4" strokeLinecap="round" fill="none" />
  <rect x="7" y="24" width="8" height="12" rx="3" fill={c2} stroke={c} strokeWidth="2" />
  <rect x="33" y="24" width="8" height="12" rx="3" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M37 36c0 4-4 6-9 6" stroke={c} strokeWidth="2" strokeLinecap="round" fill="none" />
  <rect x="21" y="39.5" width="8" height="5" rx="2.5" fill={c} />
</>);
const Radio = ({ c, c2 }: P) => (<>
  <rect x="11" y="16" width="26" height="27" rx="4" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M16 16V6" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
  <rect x="15.5" y="21" width="17" height="8" rx="2" fill="#fff" stroke={c} strokeWidth="1.8" />
  <circle cx="18.5" cy="36" r="2.2" fill={c} /><circle cx="24" cy="36" r="2.2" fill={c} fillOpacity=".6" /><circle cx="29.5" cy="36" r="2.2" fill={c} fillOpacity=".35" />
  <path d="M38 8a9 9 0 0 1 3.5 7M35.5 11a5 5 0 0 1 2 4" stroke={c} strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" fill="none" />
</>);
const UserI = ({ c, c2 }: P) => (<>
  <circle cx="24" cy="16" r="8" fill={c2} stroke={c} strokeWidth="2" />
  <path d="M9 41c1.6-8.4 7.4-13 15-13s13.4 4.6 15 13z" fill="#fff" stroke={c} strokeWidth="2" strokeLinejoin="round" />
  <path d="M19 35h10" stroke={c} strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
</>);
const Login = ({ c, c2 }: P) => (<>
  <path d="M26 7h10a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H26" fill={c2} stroke={c} strokeWidth="2" strokeLinecap="round" />
  <path d="M7 24h22M22 16.5L29.5 24 22 31.5" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
</>);
const Gear = ({ c, c2 }: P) => (<>
  <path d="M21 5h6l1 5 4 2 4.5-2.6 4.2 4.2L38 18l2 4 5 1v6l-5 1-2 4 2.7 4.4-4.2 4.2L32 40l-4 2-1 5h-6l-1-5-4-2-4.5 2.6-4.2-4.2L10 34l-2-4-5-1v-6l5-1 2-4-2.7-4.4 4.2-4.2L16 12l4-2z" fill={c2} stroke={c} strokeWidth="2" strokeLinejoin="round" transform="scale(.92) translate(2 0)" />
  <circle cx="24" cy="24" r="6.5" fill="#fff" stroke={c} strokeWidth="2.2" />
</>);
export const KPI_ICONS = { send: SendI, headset: Headset, radio: Radio, user: UserI, login: Login, gear: Gear,  doc: Doc, truck: Truck, checklist: Checklist, seal: Seal, agent: Agent, suspended: Suspended, pending: Pending, siren: Siren, clock: Clock, users: Users, chart: Chart };
export type KpiIconName = keyof typeof KPI_ICONS;

/** Soft tinted tile with an illustrated icon; colours derive from the card accent. */
export function KpiIcon({ name, accent }: { name: KpiIconName | string; accent: string }) {
  const I = KPI_ICONS[name as KpiIconName] || Doc;
  return (
    <span className="k-ico" style={{ background: `${accent}14`, boxShadow: `inset 0 0 0 1px ${accent}26` }} aria-hidden>
      <svg viewBox="0 0 48 48" width="34" height="34" fill="none"><I c={accent} c2={`${accent}33`} /></svg>
    </span>
  );
}
