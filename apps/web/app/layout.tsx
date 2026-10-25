import './globals.css';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = { title: 'AcIntel · Abia Control Room', description: 'Actionable Intelligence — Abia Homeland Security control room', icons: { icon: '/favicon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f3f5f9' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-NG"><body>{children}</body></html>;
}
