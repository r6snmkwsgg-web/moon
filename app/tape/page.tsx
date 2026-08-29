import { getRecentTrades } from "@/lib/data";
import TradesList from "@/components/TradesList";

export const dynamic = "force-dynamic";

export const metadata = { title: "The Tape" };

export default async function TapePage() {
  const trades = await getRecentTrades(60);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-lg font-bold">The Tape</h1>
        <p className="text-sm text-terminal-muted">
          Every play-money trade on the exchange, as it happens.
        </p>
      </div>
      <section className="panel">
        <TradesList trades={trades} />
      </section>
    </div>
  );
}
