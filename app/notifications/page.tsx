import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import type { AppNotification } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Alerts" };

async function markAllRead() {
  "use server";
  const user = await getUser();
  if (!user) return;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);
  revalidatePath("/notifications");
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const KIND_ICON: Record<AppNotification["kind"], string> = {
  mrr: "⚡",
  move: "▲",
  invite: "🎉",
  system: "·",
};

export default async function NotificationsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/notifications");

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  const notifications = (data ?? []) as AppNotification[];
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-bold">Alerts</h1>
        {unread > 0 && (
          <form action={markAllRead}>
            <button className="btn-ghost px-2 py-1 text-xs">
              Mark all read ({unread})
            </button>
          </form>
        )}
      </div>

      <section className="panel">
        {notifications.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-terminal-muted">
            Nothing yet. Watch a ticker (☆) to get alerts on big moves and MRR
            reports.
          </p>
        ) : (
          <ul className="divide-y divide-terminal-line/40">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-baseline gap-2 px-3 py-2.5 text-sm ${
                  n.read ? "text-terminal-muted" : "text-terminal-text"
                }`}
              >
                <span aria-hidden="true">{KIND_ICON[n.kind]}</span>
                <span className="min-w-0 flex-1">{n.title}</span>
                <span className="font-mono text-[11px] text-terminal-muted">
                  {timeAgo(n.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-center text-xs text-terminal-muted">
        Alerts fire for tickers you hold or watch.{" "}
        <Link href="/" className="text-terminal-accent">
          Browse the exchange →
        </Link>
      </p>
    </div>
  );
}
