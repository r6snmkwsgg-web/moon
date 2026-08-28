import type { User } from "@supabase/supabase-js";

/**
 * Admin = email on the ADMIN_EMAILS allowlist (comma-separated env var).
 * Checked server-side only; there is no admin flag in the database.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

export function isAdminUser(user: User | null): boolean {
  return isAdminEmail(user?.email);
}
