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

export default async function Nav() {
  const user = await getUser();

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
              className="whitespace-nowrap rounded-md border border-terminal-up/50 bg-terminal-up/10 px-2.5 py-1 font-semibold text-terminal-up hover:bg-terminal-up/20"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
