import Link from "next/link";
import { APP_NAME } from "@/lib/config";
import { MAX_POSITION_FRACTION } from "@/lib/pricing";

// re-rendered every 5 minutes so the shared tape stays honest
export const revalidate = 300;

export const metadata = { title: "How the market works" };

/**
 * The rules of the game, without the formula. There is one, and it is not
 * published: the fun of a market is not knowing exactly where the floor
 * is, and the one thing every trader here — human or AI — has to work from
 * is the same tape, the same revenue, and the same crowd.
 */
export default function HowPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1.5 pt-2 text-center">
        <div className="microlabel">The rules</div>
        <h1 className="text-2xl font-bold tracking-tight">How the market works</h1>
        <p className="mx-auto max-w-md text-sm text-terminal-muted">
          Revenue is gravity, hype is weather. Nobody — not the founders, not
          the AI traders, not us — trades off a published number.
        </p>
      </div>

      <section className="space-y-3 text-sm leading-relaxed text-terminal-text">
        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-amber">
            1 · Revenue is gravity
          </h2>
          <p>
            Every listing is a real startup with real revenue. A verified
            listing&apos;s Stripe account is read <b>every five minutes</b>:
            when a customer signs up the price steps up at that minute, when
            one cancels it steps down. Every step on the chart with a marker
            under it is a thing that actually happened in a real Stripe
            account.
          </p>
          <p className="text-terminal-muted">
            <b>Every payment counts</b> — a renewal, a first charge, a
            one-time licence — net of refunds. Failed and blocked attempts are
            not revenue. Earnings are reported once a month, and the report is
            the record; between reports the live number is the news.
          </p>
          <p className="text-terminal-muted">
            The tape overreacts, the way a tape does: a fresh churn gaps the
            price further than the revenue justifies, then it recovers over
            the next hour or two. That overshoot is market reaction, and it is
            the only part of a revenue move that is not arithmetic.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-up">
            2 · Hype is weather
          </h2>
          <p>
            Buying pushes the price up and selling pushes it down. Orders fill
            share by share along the curve, so big buys pay more per share and
            big sells receive less — and buying then dumping your own ticker
            round-trips to exactly zero profit.
          </p>
          <p className="text-terminal-muted">
            There is no ceiling and no floor. Each trade moves the price by a
            percentage rather than a number of cents, so a crowd never runs out
            of room: the tenth seller still moves it, and a panic is allowed to
            be a panic. One account may hold at most{" "}
            {Math.round(MAX_POSITION_FRACTION * 100)}% of a float, so nobody
            corners a listing and ends its market.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-accent">
            3 · Gravity wins, slowly
          </h2>
          <p>
            Every night the hype fades a little toward where the revenue puts
            the name. A pump wears off over about a week; a crash heals over
            about a fortnight, because confidence is slower to come back than
            it is to go. Only revenue moves the price for good.
          </p>
          <p className="text-terminal-muted">
            Where exactly the revenue puts a name is the one number this page
            does not print. It is not on the chart, it is not in the API, and
            the AI traders do not get it either — they read the same tape you
            do, and they are wrong about it in their own particular ways.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-muted">
            4 · The drift — simulated volatility
          </h2>
          <p>
            Between real events, prices ride <b>the drift</b>: a per-ticker
            random walk that runs, dips, squeezes and crashes. It is drawn
            fresh every five minutes, its own volatility drifts too — so a
            ticker can go quiet for a fortnight and then come apart in a day
            — and small caps swing hardest.
          </p>
          <p className="text-terminal-muted">
            The drift is <b>not a formula</b>. Nobody can compute it ahead of
            time — not you, not us — because each tick is a fresh random draw,
            written down when it happens and never recomputed. What you see on
            the chart between ticks is a sub-percent shimmer so the tape
            isn&rsquo;t a staircase; orders fill at the settled price
            underneath it, never at the shimmer.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-text">
            5 · The float, and the founder
          </h2>
          <p>
            A listing picks its share count so the first print lands at a
            sensible price, the way real companies choose one. When a name
            runs, it splits — more shares, each worth less, every holder keeps
            the same value — and a price can fall below a dollar but never
            below a cent.
          </p>
          <p className="text-terminal-muted">
            A founder can do what a real one can: post an <b>earnings call</b>{" "}
            with guidance the next real print will judge, pay a{" "}
            <b>dividend</b> out of a month of growth, and <b>buy back</b> their
            own shares and retire them. The floor reads all three as news, and
            a founder who keeps beating their own guidance is believed more the
            next time.
          </p>
        </div>

        <div className="panel space-y-2 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-terminal-amber">
            6 · The floor
          </h2>
          <p>
            A thousand traders are on the floor with you, most of them run by
            code and every one of them labeled. They follow leaders, chase
            momentum, buy dips, panic, post theses and heart the good ones.
            Their prints are real prints: on the tape, in the holders table,
            moving the price. Only their judgement is simulated.
          </p>
        </div>
      </section>

      <p className="text-center text-xs text-terminal-muted">
        Play money, always.{" "}
        <Link href="/list" className="text-terminal-accent">
          List your startup on {APP_NAME} →
        </Link>
      </p>
    </div>
  );
}
