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
        // Dark stock-terminal palette
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
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
