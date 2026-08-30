import { Suspense } from "react";
import Link from "next/link";
import { ChartLine, ShieldCheck, Zap } from "lucide-react";
import { getMarket } from "@/lib/data";
import { fmtCompact, fmtPrice } from "@/lib/format";
import ChangePct from "@/components/ChangePct";
import LogoTile from "@/components/LogoTile";
import Sparkline from "@/components/Sparkline";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Claim your $10,000" };

const PERKS = [
  {
    icon: ChartLine,
    text: "Trade real indie SaaS startups with $10,000 of play money",
  },
  {
    icon: Zap,
    text: "Prices anchored to real, Stripe-verified revenue",
  },
  {
    icon: ShieldCheck,
    text: "No card, no confirmation email — you're trading in 10 seconds",
  },
] as const;

export default async function LoginPage() {
  const market = await getMarket();
  const top = market.slice(0, 5);
  const totalCap = market.reduce((s, q) => s + q.marketCap, 0);

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 py-8 lg:grid-cols-[1fr_360px] lg:py-14">
      {/* the pitch + form */}
      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight [text-wrap:balance]">
            Claim your <span className="font-mono text-terminal-up">$10,000</span>
          </h1>
          <p className="text-sm text-terminal-muted">
            One form. New email = new account, instantly signed in.
          </p>
        </div>

        <ul className="space-y-2">
          {PERKS.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-start gap-2.5 text-sm text-terminal-muted"
            >
              <Icon size={15} className="mt-0.5 shrink-0 text-terminal-up" />
              {text}
            </li>
          ))}
        </ul>

        <div className="panel max-w-sm p-4">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="text-[11px] text-terminal-muted/80">
          Play money. Not real securities — nothing cashes out, ever.
        </p>
      </div>

      {/* the market, live, as the reason to bother */}
      <div className="panel self-start overflow-hidden">
        <div className="flex items-center gap-2 border-b border-terminal-line px-3 py-2.5">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
          <span className="microlabel font-bold !text-terminal-text">
            Live right now
          </span>
          <span className="microlabel ml-auto">
            {fmtCompact(totalCap)} cap
          </span>
        </div>
        <ul className="divide-y divide-terminal-line/40">
          {top.map((q) => (
            <li key={q.ticker.id}>
              <Link
                href={`/t/${q.ticker.symbol}`}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-terminal-raise/60"
              >
                <LogoTile
                  symbol={q.ticker.symbol}
                  logoUrl={q.ticker.logo_url}
                  size={26}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[13px] font-bold">
                    ${q.ticker.symbol}
                  </span>
                  <span className="block truncate text-[11px] text-terminal-muted">
                    {q.ticker.name}
                  </span>
                </span>
                <Sparkline values={q.spark} up={q.weekChange >= 0} width={64} height={22} />
                <span className="w-16 text-right">
                  <span className="num block font-mono text-[13px] font-semibold">
                    {fmtPrice(q.price)}
                  </span>
                  <ChangePct value={q.dayChange} className="text-[11px]" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-terminal-line px-3 py-2 text-center">
          <Link href="/" className="text-[11px] text-terminal-accent">
            see the whole board →
          </Link>
        </div>
      </div>
    </div>
  );
}
