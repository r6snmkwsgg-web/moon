"use client";

import { useState } from "react";

/** "Share your chart" — copies the ticker link; the OG card does the rest. */
export default function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your chart link:", url);
    }
  }

  return (
    <button onClick={copy} className="btn-ghost text-xs" type="button">
      {copied ? "✓ Link copied — paste it on X/Threads" : "⇪ Share your chart"}
    </button>
  );
}
