"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChartLine, Rss, Trophy, Wallet } from "lucide-react";

const TABS = [
  { href: "/", label: "Market", icon: ChartLine },
  { href: "/tape", label: "Feed", icon: Rss },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/leaderboard", label: "Leaders", icon: Trophy },
  { href: "/notifications", label: "Alerts", icon: Bell },
] as const;

/**
 * The mobile tab bar — every core surface one thumb-tap away, always.
 * Desktop navigates through the top nav instead (this is sm:hidden).
 */
export default function BottomNav({ unread }: { unread: number }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-terminal-line bg-terminal-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <div className="grid grid-cols-5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-col items-center gap-0.5 py-2 font-mono text-[10px] transition-colors ${
                active ? "text-terminal-text" : "text-terminal-muted"
              }`}
            >
              {active && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-terminal-up" />
              )}
              <span className="relative">
                <Icon size={17} strokeWidth={active ? 2.25 : 2} />
                {href === "/notifications" && unread > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-terminal-down px-0.5 font-mono text-[8px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
