import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { APP_NAME, APP_TAGLINE, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { Suspense } from "react";
import { getUser } from "@/lib/supabase/server";
import Nav from "@/components/Nav";
import TickerTape from "@/components/TickerTape";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { BottomNavWithUnread } from "@/components/UnreadBadge";
import LiveRefresh from "@/components/LiveRefresh";
import "./globals.css";

const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: `${APP_TAGLINE} ${GUARDRAIL_TEXT}`,
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // verified locally against the project's signing key — no round trip
  const user = await getUser().catch(() => null);

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <LiveRefresh />
        <Nav />
        {/* the board's prices ride in behind the shell, never ahead of it */}
        <Suspense fallback={<div className="h-8 border-b border-terminal-line" aria-hidden="true" />}>
          <TickerTape />
        </Suspense>
        <main className="shell flex-1 py-6 pb-24 sm:pb-6">
          {children}
        </main>
        <Footer />
        <Suspense fallback={<BottomNav unread={0} />}>
          <BottomNavWithUnread userId={user?.id ?? null} />
        </Suspense>
      </body>
    </html>
  );
}
