import { getUnreadCount } from "@/lib/data";
import BottomNav from "@/components/BottomNav";

/**
 * The unread count, fetched where it is shown. The nav and the tab bar
 * used to wait on this before the page could start; now the shell renders
 * at once and the badge streams in behind it.
 */
export async function AlertsBadge({ userId }: { userId: string }) {
  const unread = await getUnreadCount(userId).catch(() => 0);
  if (unread <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terminal-down px-1 font-mono text-[9px] font-bold text-white">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

/** The mobile tab bar with its badge — the same bar, once the count is in. */
export async function BottomNavWithUnread({ userId }: { userId: string | null }) {
  const unread = userId ? await getUnreadCount(userId).catch(() => 0) : 0;
  return <BottomNav unread={unread} />;
}
