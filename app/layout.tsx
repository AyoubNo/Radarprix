import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrixRadar Maroc — Les meilleures affaires classées",
  description: "Classement automatique des promotions PC, gaming, maison et électroménager au Maroc.",
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
