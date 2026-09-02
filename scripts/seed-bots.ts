/**
 * Register the AI traders as accounts: the twelve originals (lib/bot-roster)
 * and, with 0009 applied, a generated population (lib/personas).
 *
 * Each bot is an ordinary auth user with a mailbox nobody reads and a
 * password nobody knows, so the signup trigger provisions its profile
 * exactly like a person's; this then names it, flags it, stores its persona
 * and gives it its starting stake. Idempotent: an existing bot keeps its
 * cash and its positions, and a re-run only fills in the missing ones.
 *
 *   npx tsx scripts/seed-bots.ts [--population=1000] [--seed=...] [--dry]
 */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BOTS, botEmail } from "../lib/bot-roster";
import {
  DEFAULT_POPULATION_SEED,
  generatePopulation,
  type Persona,
} from "../lib/personas";
import { personaFromSpec } from "../lib/bots";

config({ path: ".env.local" });
const DRY = process.argv.includes("--dry");
const flag = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const POPULATION = Number(flag("population") ?? 1000);
const SEED = flag("seed") ?? DEFAULT_POPULATION_SEED;
const CONCURRENCY = 12;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function migrated(): Promise<boolean> {
  const { error } = await admin.from("profiles").select("is_bot, persona").limit(1);
  return !error;
}

async function main() {
  const has0009 = await migrated();
  if (!has0009) {
    console.log(
      "0009_bot_population is not applied — seeding the twelve originals only.\n" +
        "Run supabase/migrations/0009_bot_population.sql in the SQL editor, then re-run for the population."
    );
  }

  // every existing account, by email
  const byEmail = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) byEmail.set(u.email ?? "", u.id);
    if (data.users.length < 1000) break;
  }
  // usernames already taken by people (and earlier runs)
  const { data: profileRows } = await admin.from("profiles").select("username").limit(10000);
  const taken = new Set(
    ((profileRows ?? []) as { username: string | null }[]).map((r) => r.username ?? "").filter(Boolean)
  );

  const originals = BOTS.map((b) => personaFromSpec(b));
  const generated = has0009
    ? generatePopulation(
        POPULATION,
        SEED,
        [...BOTS.map((b) => b.username), ...[...taken].filter((u) => !BOTS.some((b) => b.username === u))]
      )
    : [];
  // a generated username that an earlier run already registered is the same
  // bot; generatePopulation avoided people's names but not its own earlier
  // output, so re-derive: anything whose mailbox exists is kept, not renamed
  const personas: Persona[] = [...originals, ...generated];

  let created = 0;
  let kept = 0;
  let index = 0;
  const work = async () => {
    for (;;) {
      const p = personas[index++];
      if (!p) return;
      const email = botEmail(p.username);
      let id = byEmail.get(email);
      const fresh = !id;
      if (DRY) {
        if (fresh) created++;
        else kept++;
        continue;
      }
      if (!id) {
        const { data: made, error } = await admin.auth.admin.createUser({
          email,
          password: randomBytes(24).toString("base64url"),
          email_confirm: true,
        });
        if (error || !made.user) throw new Error(`${p.username}: ${error?.message ?? "no user"}`);
        id = made.user.id;
        byEmail.set(email, id);
      }
      const patch: Record<string, unknown> = { display_name: p.name, username: p.username };
      if (fresh) patch.cash = p.cash;
      if (has0009) {
        patch.is_bot = true;
        patch.persona = p;
      }
      const { error: pe } = await admin.from("profiles").update(patch).eq("id", id);
      if (pe) throw new Error(`${p.username}: ${pe.message}`);
      if (fresh) created++;
      else kept++;
      if ((created + kept) % 100 === 0) console.log(`  ${created + kept}/${personas.length}…`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, work));

  const stakes = personas.map((p) => p.cash).sort((a, b) => a - b);
  const q = (x: number) => stakes[Math.floor(x * (stakes.length - 1))];
  console.log(
    `\n${personas.length} bots: ${created} created, ${kept} kept${DRY ? " (dry run)" : ""}\n` +
      `stakes: min $${q(0)} · median $${q(0.5)} · p90 $${q(0.9)} · p99 $${q(0.99)} · max $${q(1)} · total $${stakes.reduce((a, b) => a + b, 0).toLocaleString("en-US")}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
