"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/", label: "Market" },
  { href: "/tape", label: "Feed" },
  { href: "/leaderboard", label: "Leaders" },
] as const;

/** Desktop nav links with an active state — you always know where you are. */
export default function NavLinks() {
  const pathname = usePathname();

  return (
    <span className="hidden items-center gap-1 sm:flex">
      {LINKS.map(({ href, label }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded px-2 py-1 transition-colors ${
              active
                ? "bg-terminal-raise text-terminal-text"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </span>
  );
}
