/**
 * Register the AI traders (lib/bot-roster) as accounts.
 *
 * Each bot is an ordinary auth user with a mailbox nobody reads and a password
 * nobody knows, so the signup trigger provisions its profile exactly like a
 * person's; this then names it, gives it its username and its starting stake.
 * Idempotent: an existing bot keeps its cash and its positions.
 *
 *   npx tsx scripts/seed-bots.ts [--dry]
 */
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { BOTS, botEmail } from "../lib/bot-roster";

config({ path: ".env.local" });
const DRY = process.argv.includes("--dry");

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const byEmail = new Map(data.users.map((u) => [u.email ?? "", u.id]));

  let created = 0;
  let kept = 0;
  for (const bot of BOTS) {
    const email = botEmail(bot.username);
    let id = byEmail.get(email);
    const fresh = !id;
    if (!id) {
      if (DRY) {
        console.log(`${bot.username.padEnd(16)} would be created (${bot.style}, $${bot.cash.toLocaleString("en-US")})`);
        created++;
        continue;
      }
      const { data: made, error: e } = await admin.auth.admin.createUser({
        email,
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
      });
      if (e || !made.user) throw new Error(`${bot.username}: ${e?.message ?? "no user"}`);
      id = made.user.id;
    }
    // the signup trigger has made the profile; give it its identity — and on
    // a first run, its stake. A re-run never resets a bot that has traded.
    const patch: Record<string, unknown> = {
      display_name: bot.name,
      username: bot.username,
    };
    if (fresh) patch.cash = bot.cash;
    if (!DRY) {
      const { error: pe } = await admin.from("profiles").update(patch).eq("id", id);
      if (pe) throw new Error(`${bot.username}: ${pe.message}`);
    }
    console.log(
      `${bot.username.padEnd(16)} ${fresh ? "created" : "kept   "}  ${bot.style.padEnd(8)} ${fresh ? "$" + bot.cash.toLocaleString("en-US") : ""}`
    );
    if (fresh) created++;
    else kept++;
  }
  console.log(`\n${created} created, ${kept} kept${DRY ? " (dry run)" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
