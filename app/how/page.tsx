import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import {
  ARR_MULTIPLE,
  MULTIPLE_CEILING,
  MULTIPLE_FLOOR,
  SENTIMENT_DAILY_DECAY,
  SENTIMENT_DAILY_DECAY_DOWN,
  MAX_POSITION_FRACTION,
  SHOCK_CAP,
  SHOCK_HALFLIFE_MS,
  SHOCK_OVERSHOOT,
  TARGET_OPENING_PRICE,
  TRADE_IMPACT_FACTOR,
} from "@/lib/pricing";
import { fmtPrice } from "@/lib/format";
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
            Every startup is valued on <b>annual</b> revenue — the way SaaS
            actually changes hands — and that value is spread over the shares
            it issued at IPO:
          </p>
          <p className="num rounded-md border border-terminal-amber/20 bg-terminal-bg px-4 py-3.5 text-center font-mono text-sm font-semibold tracking-tight text-terminal-amber sm:text-base">
            fair_price = (monthly revenue × 12 × multiple) ÷ shares
          </p>
          <p className="text-terminal-muted">
            <b>Every payment counts</b> — a renewal, a first charge, a
            one-time licence. The monthly figure is the run rate implied by
            money actually received, net of refunds, averaged so a single big
            sale lifts it and then fades rather than dropping off a cliff a
            month later. Failed and blocked attempts are not revenue.
          </p>
          <p className="text-terminal-muted">
            It used to anchor on MRR alone, and that was wrong twice over: it
            shut out every business that doesn&apos;t bill on a subscription,
            and even for the ones that do it missed most of what happened —
            a renewal changes no run rate, so a founder could collect all day
            and watch their ticker sit still. A subscription business lands in
            the same place either way, because a month of renewals averages
            out to its MRR.
          </p>
          <p className="text-terminal-muted">
            A listing picks its share count so the first print lands near{" "}
            {fmtPrice(TARGET_OPENING_PRICE)} — the same reason real companies
            choose one. It changes nothing about what the company is worth:
            market cap is revenue × 12 × multiple however many slices it is
            cut into. One account may hold at most{" "}
            {Math.round(MAX_POSITION_FRACTION * 100)}% of a float, so nobody
            corners a listing and ends its market.
          </p>
          <p className="text-terminal-muted">
            Stripe is re-read every five minutes, so the anchor moves as the
            money lands. That&apos;s the earnings report, and it never stops.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-amber">
            2 · The multiple — what durability is worth
          </h2>
          <p>
            Not every dollar of revenue is worth the same. A business that has
            held {"$"}25k/mo for three years is worth far more than one that
            touched {"$"}25k last month on a spike, so the multiple is earned
            from the revenue record itself:
          </p>
          <ul className="space-y-1 text-terminal-muted">
            <li>
              <b className="text-terminal-text">Track record</b> — a brand-new
              listing prices at 0.75× the {ARR_MULTIPLE}× baseline; two years
              of reported months earns 1.30×.
            </li>
            <li>
              <b className="text-terminal-text">Growth</b> — trailing monthly
              compounding, the dominant driver in real markets. Flat is
              neutral, +10%/mo nearly doubles it, shrinking revenue is
              discounted hard.
            </li>
            <li>
              <b className="text-terminal-text">Steadiness</b> — the spread of
              those monthly moves. Boring and consistent earns a premium;
              spiky earns a discount, because a spike isn&apos;t a business.
            </li>
          </ul>
          <p className="text-terminal-muted">
            The result is clamped to {MULTIPLE_FLOOR}×–{MULTIPLE_CEILING}× ARR
            and shown on every ticker page, so you can always see what the
            market is paying for that revenue — and watch it expand as a
            founder strings good months together.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-amber">
            3 · The pulse — revenue as it happens
          </h2>
          <p>
            A verified listing&apos;s Stripe account is read{" "}
            <b>every five minutes</b>. When a customer signs up the price steps
            up at that minute; when one cancels it steps down. Earnings are
            still only <b>reported</b> once a month — the report is the record,
            and the handover is seamless because fair value is linear in
            revenue: pricing off $11K unreported is arithmetically identical to
            pricing off an $11K report.
          </p>
          <p className="text-terminal-muted">
            On top of the step, the tape overshoots and settles — a fresh churn
            gaps the price down about{" "}
            {(SHOCK_OVERSHOOT * 100 - 100).toFixed(0)}% further than the
            revenue justifies, then recovers, halving every{" "}
            {Math.round(SHOCK_HALFLIFE_MS / 60_000)} minutes. That overshoot is
            the one part of a revenue move that is market reaction rather than
            arithmetic, and it is capped at ±{(SHOCK_CAP * 100).toFixed(0)}%.
            Every step on the chart with a marker under it is a real thing that
            happened in a real Stripe account.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            4 · The weather — hype
          </h2>
          <p>
            Buying pushes sentiment up, selling pushes it down — trading 10%
            of the float moves the price about{" "}
            {((Math.exp(0.1 * TRADE_IMPACT_FACTOR) - 1) * 100).toFixed(0)}%:
          </p>
          <p className="num rounded-md border border-terminal-up/20 bg-terminal-bg px-4 py-3.5 text-center font-mono text-sm font-semibold tracking-tight text-terminal-up sm:text-base">
            live_price = fair_price × e^sentiment
          </p>
          <p className="text-terminal-muted">
            There is no ceiling and no floor. Each trade moves the price by the
            same percentage rather than the same number of cents, so a crowd
            never runs out of room: the tenth seller still moves it, and the
            price can approach zero without ever arriving. A panic is allowed
            to be a panic.
          </p>
          <p className="text-terminal-muted">
            Orders fill share-by-share along that curve, so big buys pay more
            per share and big sells receive less — and buying then dumping
            your own ticker round-trips to exactly zero profit.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-accent">
            5 · Gravity — decay
          </h2>
          <p>
            Every night, sentiment shrinks toward zero — but not evenly. Hype
            fades {(SENTIMENT_DAILY_DECAY * 100).toFixed(0)}% a night and is
            gone in about a week; a crash only heals{" "}
            {(SENTIMENT_DAILY_DECAY_DOWN * 100).toFixed(0)}% a night and takes
            a fortnight, because confidence is slower to come back than it is
            to go. Only revenue moves the price for good.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-muted">
            6 · The drift — simulated volatility
          </h2>
          <p>
            Between real events, prices ride <b>the drift</b>: a per-ticker
            random walk that runs, dips, squeezes and crashes around the
            anchor. It is drawn fresh every five minutes, it pulls back toward
            fair value with about a three-day half-life, and its own
            volatility drifts too — so a ticker can go quiet for a fortnight
            and then come apart in a day. Small caps swing hardest. It is
            capped at ±55% either way.
          </p>
          <p className="text-terminal-muted">
            Full disclosure, and the important part: the drift is{" "}
            <b>not a formula</b>. Nobody can compute it ahead of time — not
            you, not us — because each tick is a fresh random draw, written
            down when it happens and never recomputed. It used to be a
            function of the clock, which meant anyone reading this page&rsquo;s
            source could have read tomorrow&rsquo;s prices off it today. That
            is fixed. What you see on the chart between ticks is a sub-percent
            shimmer so the tape isn&rsquo;t a staircase; orders fill at the
            settled price underneath it, never at the shimmer.
          </p>
          <p className="text-terminal-muted">
            The drift never touches the facts. MRR is real, every trade on the
            tape is real, and the anchor only moves on real revenue.
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
