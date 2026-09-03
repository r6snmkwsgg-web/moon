/**
 * lib/supabase/page-all.ts — walk a query past the API's row cap.
 *
 * PostgREST answers at most 1,000 rows per request whatever `.limit()` asks
 * for, and it does so silently: the thousand-and-first profile is simply
 * not in the array. With a thousand AI traders the population, every
 * holding and every trade in a window are all past that line, so anything
 * that reads a whole table goes through here. `make` builds a fresh query
 * for each page (builders are mutable) and must carry an `order`, since a
 * range over an unordered set is not stable between pages.
 */
export const PAGE_SIZE = 1000;

/** Pages fetched together once the first one comes back full. */
const FANOUT = 4;

/**
 * The first page says whether there is more; after that, pages come in
 * FANOUT at a time, so five thousand holdings are two round trips, not
 * five in a row. A short page ends the walk; anything requested past it
 * is empty and dropped.
 */
export async function pageAll<T>(
  make: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const first = await make(0, pageSize - 1);
  if (first.error) throw new Error(first.error.message);
  const out: T[] = [...(first.data ?? [])];
  if (out.length < pageSize) return out;
  for (let from = pageSize; ; from += FANOUT * pageSize) {
    const pages = await Promise.all(
      Array.from({ length: FANOUT }, (_, i) =>
        make(from + i * pageSize, from + (i + 1) * pageSize - 1)
      )
    );
    let short = false;
    for (const { data, error } of pages) {
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < pageSize) {
        short = true;
        break;
      }
    }
    if (short) break;
  }
  return out;
}
