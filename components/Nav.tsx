import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, LogOut, Plus } from "lucide-react";
import { isAdminUser } from "@/lib/auth";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import { getUnreadCount } from "@/lib/data";
import NavLinks from "@/components/NavLinks";
import Wordmark from "@/components/Wordmark";

async function signOut() {
  "use server";
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export default async function Nav() {
  const user = await getUser();
  const unread = user ? await getUnreadCount(user.id) : 0;

  return (
    <header className="sticky top-0 z-20 border-b border-terminal-line bg-terminal-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/">
          <Wordmark />
        </Link>

        <span className="hidden items-center gap-1.5 rounded-full border border-terminal-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-terminal-up lg:flex">
          <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-terminal-up" />
          market open
        </span>

        <nav className="ml-auto flex items-center gap-1 text-sm">
          <NavLinks />

          {user && (
            <Link
              href="/notifications"
              title="Alerts"
              className="relative hidden rounded px-2 py-1.5 text-terminal-muted hover:text-terminal-text sm:block"
            >
              <Bell size={15} aria-label="Alerts" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terminal-down px-1 font-mono text-[9px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}

          <Link
            href="/list"
            className="mr-1 flex items-center gap-1 whitespace-nowrap rounded-md border border-terminal-accent/50 bg-terminal-accent/10 px-2.5 py-1 font-semibold text-terminal-accent hover:bg-terminal-accent/20"
          >
            <Plus size={13} strokeWidth={2.5} />
            <span className="hidden sm:inline">List</span>
          </Link>

          {isAdminUser(user) && (
            <Link
              href="/admin"
              className="hidden rounded px-2 py-1 text-terminal-amber hover:text-terminal-text sm:block"
            >
              Admin
            </Link>
          )}

          {user ? (
            <form action={signOut}>
              <button
                type="submit"
                className="flex items-center rounded px-2 py-1.5 text-terminal-muted hover:text-terminal-text"
                title={`Sign out${user.email ? ` (${user.email})` : ""}`}
              >
                <LogOut size={15} aria-label="Sign out" />
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
