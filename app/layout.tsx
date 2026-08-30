import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { APP_NAME, APP_TAGLINE, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import { getUser } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/data";
import Nav from "@/components/Nav";
import TickerTape from "@/components/TickerTape";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
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
  const user = await getUser().catch(() => null);
  const unread = user ? await getUnreadCount(user.id) : 0;

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-screen flex-col">
        <LiveRefresh />
        <Nav />
        <TickerTape />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-24 sm:pb-6">
          {children}
        </main>
        <Footer />
        <BottomNav unread={unread} />
      </body>
    </html>
  );
}
