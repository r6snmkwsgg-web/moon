"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { castVote } from "@/app/t/[symbol]/actions";
import Tri from "@/components/Tri";

/** One-tap bull/bear vote with a community gauge. No comments to moderate. */
export default function VoteBar({
  tickerId,
  symbol,
  bulls,
  bears,
  myVote,
  signedIn,
}: {
  tickerId: string;
  symbol: string;
  bulls: number;
  bears: number;
  myVote: 1 | -1 | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const total = bulls + bears;
  const bullPct = total > 0 ? Math.round((bulls / total) * 100) : 50;

  function vote(v: 1 | -1) {
    if (!signedIn) {
      router.push(`/login?next=/t/${symbol}`);
      return;
    }
    startTransition(async () => {
      await castVote(tickerId, symbol, v);
      router.refresh();
    });
  }

  return (
    <div className="panel space-y-1.5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="microlabel">Community call</span>
        <span className="num font-mono text-[11px] text-terminal-muted">
          {total} vote{total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex h-1 overflow-hidden rounded-full bg-terminal-line">
        <div
          className="bg-terminal-up transition-all"
          style={{ width: `${bullPct}%` }}
        />
        <div
          className="bg-terminal-down transition-all"
          style={{ width: `${100 - bullPct}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => vote(1)}
          className={`btn px-2 py-1 text-[11px] ${
            myVote === 1
              ? "bg-terminal-up text-black"
              : "border border-terminal-up/40 text-terminal-up hover:bg-terminal-up/10"
          }`}
        >
          <Tri dir="up" size={7} />
          Bullish {bullPct}%
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => vote(-1)}
          className={`btn px-2 py-1 text-[11px] ${
            myVote === -1
              ? "bg-terminal-down text-white"
              : "border border-terminal-down/40 text-terminal-down hover:bg-terminal-down/10"
          }`}
        >
          <Tri dir="down" size={7} />
          Bearish {100 - bullPct}%
        </button>
      </div>
    </div>
  );
}
