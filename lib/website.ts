/**
 * A founder's website, as typed, into something we will link to: scheme
 * added if missing, http(s) only, capped. Null for blank; throws on junk.
 */
export function normaliseWebsite(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Websites are http(s) only.");
  }
  if (!url.hostname.includes(".")) throw new Error("That does not look like a web address.");
  return url.toString().slice(0, 200);
}
