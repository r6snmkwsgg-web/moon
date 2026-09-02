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

export async function pageAll<T>(
  make: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE_SIZE
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
