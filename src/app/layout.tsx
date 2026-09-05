import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Cinzel, Outfit } from "next/font/google";
import "./globals.css";

const display = Cinzel({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const sans = Outfit({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REALMS — The Sundered Shelf",
  description:
    "A third-person fantasy action RPG that runs in your browser. Cross a floating continent, light the shrines, and put down whatever is still wearing the Warden's armour.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#07060c] font-sans text-amber-50">{children}</body>
    </html>
  );
}
