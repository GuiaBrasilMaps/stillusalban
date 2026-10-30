import type { Metadata } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const fontSerif = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-serif-luxury',
  display: 'swap',
});

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-luxury',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'STILLUS ALBAN | Showroom & Catálogo Online — Domingos Martins, ES',
  description:
    'Showroom Digital STILLUS ALBAN — Bolsas, calçados e acessórios em estoque próprio e sob encomenda com atendimento exclusivo em Domingos Martins e região (ES).',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`dark ${fontSerif.variable} ${fontSans.variable}`}>
      <body className="min-h-screen bg-[#0A0A0A] text-[#F5F5F4] selection:bg-[#D4AF37] selection:text-[#0A0A0A] antialiased">
        {children}
      </body>
    </html>
  );
}
