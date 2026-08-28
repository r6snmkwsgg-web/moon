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
    <header className="sticky top-0 z-20 border-b border-terminal-line bg-terminal-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link
          href="/"
          className="font-mono text-sm font-bold tracking-widest text-terminal-up"
        >
          ▲ {APP_NAME}
        </Link>
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
              className="rounded border border-terminal-line px-2.5 py-1 text-terminal-text hover:border-terminal-muted"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
