"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Opening the alerts is reading them. Mounts on the page, marks everything
 * read, then refreshes so the badge in the nav goes away — the list you are
 * looking at was rendered with its unread rows highlighted and stays that
 * way until the refresh lands, which is the moment you have seen them.
 */
export default function MarkRead({
  unread,
  action,
}: {
  unread: number;
  action: () => Promise<void>;
}) {
  const router = useRouter();
  useEffect(() => {
    if (unread === 0) return;
    let cancelled = false;
    action().then(() => {
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [unread, action, router]);
  return null;
}
