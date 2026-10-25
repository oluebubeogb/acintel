import { AppProvider } from '@/components/providers';
import { Shell } from '@/components/shell';
export default function HqLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider><Shell>{children}</Shell></AppProvider>;
}
