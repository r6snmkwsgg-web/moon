import { redirect } from "next/navigation";
import { createSupabaseServerClient, getUser } from "@/lib/supabase/server";
import { fmtMoney } from "@/lib/format";
import { STARTING_CASH } from "@/lib/config";
import HandleForm from "./HandleForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Pick your handle" };

/**
 * The one onboarding step: claim a handle. New signups land here right
 * after account creation; it doubles as the handle editor later (linked
 * from the portfolio).
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect("/login?next=/welcome");
  // where they were headed when they were asked to sign in — a relative path
  // only, so this can never bounce anyone off-site
  const { next: nextParam } = await searchParams;
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  const supabase = await createSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, cash")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-sm space-y-5 py-10">
      <div className="space-y-1.5 text-center">
        <div className="microlabel">Account live</div>
        <h1 className="text-2xl font-bold tracking-tight">
          You&apos;re holding{" "}
          <span className="font-mono text-terminal-up">
            {fmtMoney(Number(profile?.cash ?? STARTING_CASH), 0)}
          </span>
        </h1>
        <p className="text-sm text-terminal-muted">
          Pick your trader handle — it&apos;s your name on the tape, the
          floor, and the leaderboard.
        </p>
      </div>

      <div className="panel p-4">
        <HandleForm current={profile?.username ?? ""} next={next} />
      </div>

      <p className="text-center text-[11px] text-terminal-muted/80">
        Play money only — nothing here is real or cashes out, ever.
      </p>
    </div>
  );
}
