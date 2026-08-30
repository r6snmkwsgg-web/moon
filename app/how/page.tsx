import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import {
  ARR_MULTIPLE,
  SENTIMENT_CAP,
  SENTIMENT_DAILY_DECAY,
  SHARES_OUTSTANDING,
  TRADE_IMPACT_FACTOR,
} from "@/lib/pricing";
import PricingPlayground from "./PricingPlayground";

// re-rendered every 5 minutes so the shared tape stays honest
export const revalidate = 300;

export const metadata = { title: "How pricing works" };

export default function HowPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5 pt-2 text-center">
        <div className="microlabel">The open formula</div>
        <h1 className="text-2xl font-bold tracking-tight">
          How pricing works
        </h1>
        <p className="mx-auto max-w-md text-sm text-terminal-muted">
          The whole market runs on one open formula. No black box, no order
          book — revenue is gravity, hype is weather.
        </p>
      </div>

      <section className="space-y-3 text-sm leading-relaxed text-terminal-text">
        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-amber">
            1 · The anchor — fair value
          </h2>
          <p>
            Every startup has exactly{" "}
            <span className="num font-mono">{SHARES_OUTSTANDING.toLocaleString("en-US")}</span>{" "}
            fake shares. Its fair value per share is a toy{" "}
            <span className="font-mono">{ARR_MULTIPLE}× annual revenue</span>{" "}
            multiple:
          </p>
          <p className="num rounded-md border border-terminal-amber/20 bg-terminal-bg px-4 py-3.5 text-center font-mono text-sm font-semibold tracking-tight text-terminal-amber sm:text-base">
            fair_price = (MRR × 12 × {ARR_MULTIPLE}) ÷{" "}
            {SHARES_OUTSTANDING.toLocaleString("en-US")}
          </p>
          <p className="text-terminal-muted">
            When a founder&apos;s MRR updates — auto-synced from Stripe
            monthly, or posted manually — the anchor reprices instantly.
            That&apos;s the earnings report.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            2 · The weather — hype
          </h2>
          <p>
            Buying pushes sentiment up, selling pushes it down (trading 10% of
            the float moves it {(0.1 * TRADE_IMPACT_FACTOR * 100).toFixed(0)}{" "}
            points), and it&apos;s hard-capped at ±
            {(SENTIMENT_CAP * 100).toFixed(0)}%:
          </p>
          <p className="num rounded-md border border-terminal-up/20 bg-terminal-bg px-4 py-3.5 text-center font-mono text-sm font-semibold tracking-tight text-terminal-up sm:text-base">
            live_price = fair_price × (1 + sentiment)
          </p>
          <p className="text-terminal-muted">
            Orders fill share-by-share along that curve, so big buys pay more
            per share and big sells receive less — and buying then dumping
            your own ticker round-trips to exactly zero profit.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-accent">
            3 · Gravity — decay
          </h2>
          <p>
            Every night, sentiment shrinks{" "}
            {(SENTIMENT_DAILY_DECAY * 100).toFixed(0)}% toward zero. Hype
            fades in about two weeks; only revenue moves the price for good.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-muted">
            4 · The flow — simulated volatility
          </h2>
          <p>
            Between real events, prices ride <b>the flow</b>: a per-ticker
            volatility field that runs, dips, squeezes and chops around the
            anchor — small caps swing harder, hyped tickers chop more, and
            everything eventually blows back toward fair value.
          </p>
          <p className="text-terminal-muted">
            Full disclosure: the flow is pure game physics — deterministic,
            identical for every player, capped at about ±55%, and it never
            touches the facts. MRR is real, every trade on the tape is real,
            and the anchor only moves on real revenue. The flow is what makes
            it a market you can day trade instead of a spreadsheet you check
            monthly. Orders fill at the flow price you see quoted.
          </p>
        </div>
      </section>

      <PricingPlayground />

      <p className="text-center text-xs text-terminal-muted">
        Play money, always.{" "}
        <Link href="/list" className="text-terminal-accent">
          List your startup on {APP_NAME} →
        </Link>
      </p>
    </div>
  );
}
