import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Hook Explorer — Uniswap v4",
  description:
    "Paste a Uniswap v4 hook address to decode its permissions, inspect its on-chain state, review risk heuristics, and find the pools that use it.",
  openGraph: {
    title: "Hook Explorer — Uniswap v4",
    description:
      "Decode a v4 hook's permissions straight from its address, plus risk heuristics and associated pools.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
