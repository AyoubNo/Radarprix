import type { Metadata } from "next";
import { siteOrigin } from "../server/product-seo.mjs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: "PrixRadar Maroc — Les meilleures affaires classées",
  description: "Comparez les prix au Maroc avec leur historique réel et découvrez les affaires PC, gaming, maison et électroménager classées par PrixRadar.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_MA",
    siteName: "PrixRadar Maroc",
    title: "PrixRadar Maroc — Les meilleures affaires classées",
    description: "Comparez les prix actuels à leur historique réel chez les marchands marocains.",
    url: "/",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
