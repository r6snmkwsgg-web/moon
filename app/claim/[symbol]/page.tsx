import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import type { Claim, Ticker } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Claim your ticker" };

/**
 * Founder claim flow: sign in → submit your X/Threads handle → admin approves
 * manually. The insert runs as the signed-in user; RLS only allows claiming
 * for yourself with status "pending".
 */
async function submitClaim(formData: FormData) {
  "use server";
  const user = await getUser();
  if (!user) redirect("/login");

  const tickerId = String(formData.get("ticker_id") ?? "");
  const symbol = String(formData.get("symbol") ?? "");
  const handle = String(formData.get("handle") ?? "")
    .trim()
    .replace(/^@/, "")
    .slice(0, 50);
  if (!tickerId || !/^[A-Za-z0-9_.]{1,50}$/.test(handle)) {
    throw new Error("Enter a valid handle.");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.from("claims").insert({
    ticker_id: tickerId,
    user_id: user.id,
    handle,
    status: "pending",
  });

  revalidatePath(`/claim/${symbol}`);
}

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const user = await getUser();
  const supabase = await createSupabaseServerClient();

  const { data: ticker } = (await supabase
    .from("tickers")
    .select("*")
    .ilike("symbol", symbol)
    .maybeSingle()) as { data: Ticker | null };
  if (!ticker) notFound();

  let myClaim: Claim | null = null;
  if (user) {
    const { data } = await supabase
      .from("claims")
      .select("*")
      .eq("ticker_id", ticker.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    myClaim = data as Claim | null;
  }

  return (
    <div className="mx-auto max-w-md space-y-5 py-8">
      <div>
        <h1 className="font-mono text-lg font-bold">
          Claim ${ticker.symbol}
        </h1>
        <p className="text-sm text-terminal-muted">
          {ticker.name} — {ticker.pitch}
        </p>
      </div>

      {ticker.claimed ? (
        <p className="panel p-4 text-sm text-terminal-muted">
          This ticker is already claimed by its founder.{" "}
          <Link href={`/t/${ticker.symbol}`} className="text-terminal-accent">
            Back to the chart →
          </Link>
        </p>
      ) : !user ? (
        <div className="panel space-y-3 p-4 text-sm">
          <p className="text-terminal-muted">
            Are you the founder? Sign in first, then submit your X/Threads
            handle so we can verify it against the one on your public MRR
            posts.
          </p>
          <Link
            href={`/login?next=/claim/${ticker.symbol}`}
            className="btn-ghost"
          >
            Sign in to claim →
          </Link>
        </div>
      ) : myClaim && myClaim.status === "pending" ? (
        <p className="panel p-4 text-sm text-terminal-muted">
          ⏳ Claim submitted as{" "}
          <span className="font-mono text-terminal-accent">
            @{myClaim.handle}
          </span>
          . The admin reviews claims manually — once approved you can post
          self-reported MRR from your ticker page.
        </p>
      ) : myClaim && myClaim.status === "rejected" ? (
        <p className="panel p-4 text-sm text-terminal-down">
          Your previous claim was rejected. If you think that&apos;s wrong,
          reach out on X/Threads.
        </p>
      ) : (
        <form action={submitClaim} className="panel space-y-3 p-4">
          <input type="hidden" name="ticker_id" value={ticker.id} />
          <input type="hidden" name="symbol" value={ticker.symbol} />
          <label className="block text-xs text-terminal-muted">
            Your X/Threads handle (the one that posts MRR publicly)
            <input
              name="handle"
              required
              placeholder="@yourhandle"
              className="input mt-1 font-mono"
            />
          </label>
          <button type="submit" className="btn-ghost w-full">
            Submit claim for review
          </button>
          <p className="text-[11px] text-terminal-muted">
            Approval is manual. Once approved, MRR numbers you post are
            labeled “self-reported” and you can request delisting at any time.
          </p>
        </form>
      )}
    </div>
  );
}
