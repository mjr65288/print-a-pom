import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Print-A-Pom · Control Center',
  description: '3D Printer Control Interface for Print-A-Pom machines',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="scanlines">{children}</body>
    </html>
  );
}
