import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/config";
import { isAdminUser } from "@/lib/auth";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";

async function signOut() {
  "use server";
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

async function unreadCount(userId: string): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function Nav() {
  const user = await getUser();
  const unread = user ? await unreadCount(user.id) : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-terminal-line bg-terminal-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-terminal-up/15 ring-1 ring-terminal-up/40">
            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
              <path
                d="M5 22 L12 14 L17 18 L27 7"
                stroke="#22c55e"
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20 7 H27 V14"
                stroke="#22c55e"
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="whitespace-nowrap font-mono text-xs font-bold tracking-[0.18em] text-terminal-text sm:text-sm sm:tracking-[0.22em]">
            {APP_NAME}
          </span>
        </Link>

        <span className="hidden items-center gap-1.5 rounded-full border border-terminal-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-terminal-up sm:flex">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
          market open
        </span>

        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link
            href="/tape"
            className="hidden rounded px-2 py-1 text-terminal-muted hover:text-terminal-text sm:block"
          >
            Feed
          </Link>
          <Link
            href="/portfolio"
            className="rounded px-2 py-1 text-terminal-muted hover:text-terminal-text"
          >
            Portfolio
          </Link>
          <Link
            href="/leaderboard"
            className="rounded px-2 py-1 text-terminal-muted hover:text-terminal-text"
          >
            Leaders
          </Link>
          {user && (
            <Link
              href="/notifications"
              title="Alerts"
              className="relative rounded px-2 py-1 text-terminal-muted hover:text-terminal-text"
            >
              ◔
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terminal-down px-1 font-mono text-[9px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}
          <Link
            href="/list"
            className="mr-1 hidden whitespace-nowrap rounded-md border border-terminal-amber/50 bg-terminal-amber/10 px-2.5 py-1 font-semibold text-terminal-amber hover:bg-terminal-amber/20 sm:block"
          >
            + List
          </Link>
          {isAdminUser(user) && (
            <Link
              href="/admin"
              className="rounded px-2 py-1 text-terminal-amber hover:text-terminal-text"
            >
              Admin
            </Link>
          )}
          {user ? (
            <form action={signOut}>
              <button
                type="submit"
                className="rounded px-2 py-1 text-terminal-muted hover:text-terminal-text"
                title={user.email ?? undefined}
              >
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="whitespace-nowrap rounded-md bg-terminal-up px-2.5 py-1 font-bold text-black hover:bg-terminal-up/85"
            >
              <span className="sm:hidden">Get $10K</span>
              <span className="hidden sm:inline">Get $10,000 free</span>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
