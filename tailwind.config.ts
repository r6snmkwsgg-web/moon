import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark stock-terminal palette. Color discipline:
        //   up/down  → price movement ONLY
        //   amber    → revenue / MRR / earnings ONLY
        //   accent   → links and actions ONLY
        terminal: {
          bg: "#070b12", // page background
          panel: "#0b111d", // cards / rows
          raise: "#101828", // hover / raised surface
          line: "#182236", // borders
          muted: "#8494ab", // secondary text
          text: "#e8eef7", // primary text
          up: "#22c55e", // gains
          down: "#f43f5e", // losses
          accent: "#38bdf8", // links / highlights
          amber: "#fbbf24", // MRR / fair-value overlay
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      // Three radii, used everywhere: chips 6, controls 8, panels 10.
      borderRadius: {
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "10px", // legacy alias — nothing should be rounder than a panel
      },
    },
  },
  plugins: [],
};

export default config;
