import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getRecentTrades, profileExists } from "@/lib/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import TradesList from "@/components/TradesList";

export const dynamic = "force-dynamic";

const PAGE = 100;

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ before?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return { title: `${username} · trades` };
}

/** Everything someone has printed, newest first, a hundred at a time. */
export default async function ProfileTradesPage({ params, searchParams }: Props) {
  const [{ username }, { before }] = await Promise.all([params, searchParams]);
  if (!(await profileExists(username))) notFound();
  const admin = createSupabaseAdminClient();
  const [{ data: profile }, viewer] = await Promise.all([
    admin.from("profiles").select("id, display_name, username").ilike("username", username).maybeSingle(),
    getUser(),
  ]);
  if (!profile) notFound();
  const beforeIso = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null;
  const trades = await getRecentTrades(PAGE, undefined, [profile.id], false, viewer?.id ?? null, null, null, beforeIso);
  const last = trades[trades.length - 1];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="font-mono text-lg font-bold">
          <Link href={`/u/${profile.username}`} className="hover:text-terminal-accent">
            {profile.display_name}
          </Link>
          <span className="text-terminal-muted"> · trades</span>
        </h1>
        <Link href={`/u/${profile.username}`} className="font-mono text-[11px] text-terminal-accent hover:underline">
          ← profile
        </Link>
      </div>
      <section className="panel">
        <TradesList trades={trades} showSymbol showTrader={false} signedIn={viewer !== null} />
        {trades.length === PAGE && last && (
          <Link
            href={`/u/${profile.username}/trades?before=${encodeURIComponent(last.created_at)}`}
            className="block border-t border-terminal-line px-3 py-2 text-center font-mono text-[11px] text-terminal-accent hover:underline"
          >
            older →
          </Link>
        )}
        {trades.length === 0 && beforeIso && (
          <p className="px-3 py-6 text-center text-sm text-terminal-muted">
            That is all of them.
          </p>
        )}
      </section>
    </div>
  );
}
