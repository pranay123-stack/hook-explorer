import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BASE_DESCRIPTION, BASE_TITLE, resolveSiteUrl } from "@/lib/metadata";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Without metadataBase the Open Graph image resolves to a relative URL, which
  // Discord and Twitter cannot fetch -- the unfurl silently loses its image.
  metadataBase: new URL(resolveSiteUrl()),
  title: BASE_TITLE,
  description: BASE_DESCRIPTION,
  openGraph: { title: BASE_TITLE, description: BASE_DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: BASE_TITLE, description: BASE_DESCRIPTION },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
