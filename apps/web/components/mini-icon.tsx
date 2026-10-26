'use client';
/** Tiny colourful icon on a soft tint, shown beside small labels (detail cards, KPI labels). */
import {
  AtSign, BadgeCheck, Building2, CalendarClock, CalendarPlus, Clock, FileText, Fingerprint, Hash, IdCard, Layers, LogIn, MapPin,
  MessageSquare, Phone, ShieldAlert, ShieldCheck, Signal, Smartphone, Tag, User, UserCheck, Users, type LucideIcon,
} from 'lucide-react';

const MAP: [RegExp, LucideIcon, string][] = [
  [/government tag|\btag\b/i, IdCard, '#7c3aed'],
  [/phone/i, Phone, '#0d9488'],
  [/email/i, AtSign, '#db2777'],
  [/lga|location|base/i, MapPin, '#ea580c'],
  [/first name|last name|^name|sender|reporter|admin|by$/i, User, '#2563eb'],
  [/group|agency|agencies/i, Users, '#4f46e5'],
  [/presence|online/i, Signal, '#16a34a'],
  [/status/i, BadgeCheck, '#10b981'],
  [/risk/i, ShieldAlert, '#e11d48'],
  [/device|os|model/i, Smartphone, '#0891b2'],
  [/login|seen/i, LogIn, '#0ea5e9'],
  [/reg|onboard|created|posted|first seen/i, CalendarPlus, '#8b5cf6'],
  [/date|resolved|acted|approved|when/i, CalendarClock, '#f59e0b'],
  [/report|details|description|note|alert/i, FileText, '#2563eb'],
  [/category|type/i, Layers, '#d946ef'],
  [/agents|users|incidents|alarms|count|reports/i, Hash, '#64748b'],
  [/role/i, ShieldCheck, '#0f766e'],
  [/nin|id/i, Fingerprint, '#7c3aed'],
  [/message/i, MessageSquare, '#2563eb'],
  [/time|response/i, Clock, '#8b5cf6'],
  [/org|office/i, Building2, '#475569'],
  [/check/i, UserCheck, '#10b981'],
];

export function MiniIcon({ label, icon, color }: { label?: string; icon?: LucideIcon; color?: string }) {
  const hit = label ? MAP.find(([re]) => re.test(label)) : undefined;
  const I = icon || hit?.[1] || Tag;
  const c = color || hit?.[2] || '#64748b';
  return <span className="mini-ico" style={{ background: `${c}17`, color: c }} aria-hidden><I /></span>;
}
