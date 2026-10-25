/**
 * DataPort — the seam for the Phase 7 "live handshake" with Homeland CSAS.
 * Phases 0–6 ship NO implementation and make NO outbound calls: the local DB is the source of truth.
 *
 * Phase 7 plan: a HomelandDataPort implements this interface against the legacy API,
 * writes legacy ids into `legacyId` columns, pulls deltas on a schedule, and pushes dispatches/alerts upstream.
 */
export interface DataPort {
  pullUsers(since?: Date): Promise<Array<{ legacyId: string; name: string; phone: string; email?: string; lga: string; status: string; device?: string; createdAt: Date }>>;
  pullAgents(since?: Date): Promise<Array<{ legacyId: string; name: string; phone: string; lga: string; group?: string; status: string; createdAt: Date }>>;
  /** source: user | agent | call_centre | ecc; agentRef set when an agent filed it. */
  pullIncidents(since?: Date): Promise<Array<{ legacyId: string; category: string; details: string; location: string; lga: string; status: string; createdAt: Date; source?: string; agentRef?: string }>>;
  /** "Send to Vigilante": notify the agents' app (verify | confirm | resolve). */
  pushVigilante(incidentRef: string, agentRefs: string[], purpose: string): Promise<void>;
  pushDispatch(incidentRef: string, agencies: string[]): Promise<void>;
  pushSecurityAlert(alert: { title: string; body: string; lga: string; userType: string; group: string }): Promise<void>;
}

/** Standalone mode (default, and the only mode in Phases 0–6). */
export class StandaloneDataPort implements DataPort {
  async pullUsers() { return []; }
  async pullAgents() { return []; }
  async pullIncidents() { return []; }
  async pushDispatch(_incidentRef: string, _agencies: string[]) { /* no-op until Phase 7 */ }
  async pushVigilante(_incidentRef: string, _agentRefs: string[], _purpose: string) { /* no-op until Phase 7 */ }
  async pushSecurityAlert(_alert: { title: string; body: string; lga: string; userType: string; group: string }) { /* no-op until Phase 7 */ }
}
