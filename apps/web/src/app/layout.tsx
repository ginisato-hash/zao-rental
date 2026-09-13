import type { Metadata } from 'next';
import {headers} from 'next/headers';
import './globals.css';
export const metadata: Metadata = { title: 'ZAO Rental | 開発基盤', robots: { index: false, follow: false } };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale=(await headers()).get('x-zao-page-locale')==='en'?'en':'ja';
  return <html lang={locale}><body>{children}</body></html>;
}
