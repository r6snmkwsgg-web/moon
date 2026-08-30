"use client";

import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { INVITE_BONUS } from "@/lib/config";

/** Copyable invite link — both sides get the play-money bonus on signup. */
export default function InviteBox({ inviteUrl }: { inviteUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your invite link:", inviteUrl);
    }
  }

  return (
    <div className="panel flex flex-wrap items-center gap-3 border-terminal-up/25 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-terminal-text">
          <UserPlus size={14} className="shrink-0 text-terminal-accent" />
          Invite a friend — you both get +$
          {INVITE_BONUS.toLocaleString("en-US")} play money
        </div>
        <div className="num truncate font-mono text-[11px] text-terminal-muted">
          {inviteUrl}
        </div>
      </div>
      <button onClick={copy} type="button" className="btn-ghost text-xs">
        {copied ? (
          <>
            <Check size={12} className="text-terminal-up" />
            Copied
          </>
        ) : (
          "Copy link"
        )}
      </button>
    </div>
  );
}
