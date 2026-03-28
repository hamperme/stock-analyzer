import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#111118",
          hover: "#1a1a28",
          elevated: "#1e1e2e",
          border: "#252538",
        },
        app: {
          bg: "#0a0a0f",
        },
        bull: "#10b981",
        bear: "#ef4444",
        neutral: "#94a3b8",
        accent: "#3b82f6",
        warn: "#f59e0b",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
