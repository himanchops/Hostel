import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/auth";
import { TenantAuthProvider } from "@/contexts/tenantAuth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The display face, used for the wordmark and page titles only — never for
 * data. Geist is a fine workhorse but it is also the default of every AI-era
 * dev tool, so the app had no identity of its own; a warm serif at the top of
 * each page reads closer to the ledger this is meant to feel like. Numbers,
 * tables and form controls stay on Geist, where tabular figures and
 * neutrality matter more than character.
 */
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Hostel Manager",
  description: "Occupancy and rent tracking for hostel and PG owners",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased`}>
        <AuthProvider><TenantAuthProvider>{children}</TenantAuthProvider></AuthProvider>
      </body>
    </html>
  );
}
