import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SofIA Logística Inteligente',
  description: 'WMS multiempresa — IRE e ICV',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
