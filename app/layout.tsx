import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { APP_NAME, APP_TAGLINE, GUARDRAIL_TEXT, siteUrl } from "@/lib/config";
import Nav from "@/components/Nav";
import TickerTape from "@/components/TickerTape";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s · ${APP_NAME}`,
  },
  description: `${APP_TAGLINE} ${GUARDRAIL_TEXT}`,
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <TickerTape />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {children}
        </main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
