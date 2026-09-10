import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ZAO Rental | 開発基盤', robots: { index: false, follow: false } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
