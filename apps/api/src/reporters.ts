/**
 * Demo caller identities for Call Centre / ECC phone-ins, plus the anonymous mix used by seed + simulator.
 * Real data arrives via the Homeland dataport with the caller's own details.
 */
const FIRST = ['Chukwuemeka', 'Nathanial', 'Adanna', 'Obioma', 'Chidinma', 'Ugochukwu', 'Nkechi', 'Onyekachi', 'Chiamaka', 'Ifeanyi', 'Ezinne', 'Kelechi', 'Oluchi', 'Chinonso', 'Udoka', 'Nneka', 'Somtochukwu', 'Ijeoma', 'Okechukwu', 'Amarachi', 'Benjamin', 'Gift', 'Precious', 'Godwin'];
const LAST = ['Nwankwo', 'Benjamin', 'Okoro', 'Igwe', 'Uzoma', 'Ejiofor', 'Onwuka', 'Kalu', 'Nwogu', 'Uwakwe', 'Ihejirika', 'Okonkwo', 'Ogbonna', 'Anyanwu', 'Nwaigwe', 'Chukwu', 'Iroha', 'Mbah', 'Onuoha', 'Ezeala'];
const MAIL = ['gmail.com', 'gmail.com', 'gmail.com', 'yahoo.com', 'outlook.com'];

export type Caller = { reporterName: string; reporterPhone: string; reporterEmail: string | null; reporterLga: string };

export function caller(lga: string, rnd: () => number = Math.random): Caller {
  const p = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const fn = p(FIRST), ln = p(LAST);
  const phone = p(['0703', '0806', '0813', '0816', '0903', '0906', '0810', '0705']) + String(Math.floor(1000000 + rnd() * 8999999));
  const email = rnd() < 0.85 ? `${fn}${p(['', '.', '_'])}${ln}${rnd() < 0.5 ? Math.floor(rnd() * 90 + 10) : ''}@${p(MAIL)}`.toLowerCase() : null;
  // Most callers phone in about their own LGA; a few report from a neighbouring one.
  return { reporterName: `${fn} ${ln}`, reporterPhone: phone, reporterEmail: email, reporterLga: lga };
}

/** Share of reports filed anonymously, per source. */
export const ANON_RATE: Record<string, number> = { user: 0.12, agent: 0.06, call_centre: 0.18, ecc: 0.15 };
