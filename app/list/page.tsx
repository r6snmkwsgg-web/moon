import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/config";
import ListingForm from "./ListingForm";
import { connectConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export const metadata = { title: "List your startup" };

export default async function ListPage() {
  const user = await getUser();

  return (
    <div className="mx-auto max-w-lg space-y-5 py-6">
      <div>
        <h1 className="font-mono text-lg font-bold">List your startup</h1>
        <p className="mt-1 text-sm text-terminal-muted">
          Get a ticker on {APP_NAME} in about 60 seconds. Your MRR comes
          straight from Stripe — verified from day one, refreshed monthly,
          never typed in. Traders get 10,000 fake shares of you to fight over.
        </p>
      </div>

      {user ? (
        <ListingForm connectAvailable={connectConfigured()} />
      ) : (
        <div className="panel space-y-3 p-4 text-sm">
          <p className="text-terminal-muted">
            Sign in first — your listing is claimed by your account from
            birth, so only you can manage it.
          </p>
          <Link href="/login?next=/list" className="btn-ghost">
            Sign in to list →
          </Link>
        </div>
      )}
    </div>
  );
}
