"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import SearchBar from "@/components/SearchBar";

/** Search on small screens: an icon that drops a full-width bar under the nav. */
export default function MobileSearch() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close search" : "Search"}
        aria-expanded={open}
        className="rounded px-2 py-1.5 text-terminal-muted hover:text-terminal-text md:hidden"
      >
        {open ? <X size={15} /> : <Search size={15} />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-terminal-line bg-terminal-bg/95 px-4 py-2 backdrop-blur md:hidden">
          <div className="[&>div]:max-w-none">
            <SearchBar />
          </div>
        </div>
      )}
    </>
  );
}
