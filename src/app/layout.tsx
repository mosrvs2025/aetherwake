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
  title: "Aetherwake — steal the world's breath",
  description:
    "A 3D fantasy sandbox RPG where almost everything in the Vale can be witnessed, absorbed, braided, and grafted back into the land.",
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
