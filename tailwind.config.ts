import type { Config } from "tailwindcss";

const config: Config = {
  // lib/ is scanned too: shared class-name helpers live there (e.g.
  // lib/payment-meta.ts) and their classes must be generated.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Official Tanawin palette: maroon, beige, white (drawn from the logo).
        // 'sand' = beige surfaces, 'maroon' = brand accent, 'clay' = warnings,
        // 'ink' = text. Deliberately limited; ramps are functional, not decorative.
        sand: {
          50: "#FBFAF6",
          100: "#F4F1E7",
          200: "#E8E2D0",
          300: "#D5CBA9",
          400: "#B9A874",
          500: "#9A8650",
        },
        // Brand maroon, sampled from the Tanawin logo (500 ≈ the logo tile).
        maroon: {
          50: "#FBF0EC",
          100: "#F1D4C9",
          200: "#E0A593",
          300: "#CC7459",
          400: "#B14C2E",
          500: "#9A3518",
          600: "#7C2A12",
        },
        // `leaf` is the former (green) accent token. Kept as an alias of maroon
        // so the 80+ existing `leaf-*` classes retheme in one place instead of
        // a 23-file sweep. Prefer `maroon-*` in new code.
        leaf: {
          50: "#FBF0EC",
          100: "#F1D4C9",
          200: "#E0A593",
          300: "#CC7459",
          400: "#B14C2E",
          500: "#9A3518",
          600: "#7C2A12",
        },
        clay: {
          50: "#FBEEE7",
          100: "#F2CDB7",
          200: "#E5A37D",
          300: "#C97744",
          400: "#9F5523",
          500: "#73381A",
        },
        ink: {
          900: "#1F1B16",
          700: "#3F392F",
          500: "#6E6759",
          300: "#9A9384",
          100: "#C7C0AF",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
