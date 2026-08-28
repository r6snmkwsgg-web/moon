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
          bg: "#0a0e14", // page background
          panel: "#0f1520", // cards / rows
          line: "#1c2533", // borders
          muted: "#8b98ab", // secondary text
          text: "#e6edf3", // primary text
          up: "#22c55e", // gains
          down: "#f43f5e", // losses
          accent: "#38bdf8", // links / highlights
          amber: "#fbbf24", // MRR overlay / badges
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
