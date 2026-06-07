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
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          hover: "rgb(var(--color-surface-hover) / <alpha-value>)",
          elevated: "rgb(var(--color-surface-elevated) / <alpha-value>)",
          border: "rgb(var(--color-surface-border) / <alpha-value>)",
        },
        app: {
          bg: "rgb(var(--color-app-bg) / <alpha-value>)",
        },
        bull: "rgb(var(--color-bull) / <alpha-value>)",
        bear: "rgb(var(--color-bear) / <alpha-value>)",
        neutral: "rgb(var(--color-neutral) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
