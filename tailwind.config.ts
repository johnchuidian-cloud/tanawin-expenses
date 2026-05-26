import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm resort-inspired palette to match Tanawin's identity.
        // 'sand' for surfaces, 'leaf' for accents, 'clay' for warnings,
        // 'ink' for text. Deliberately limited; ramps are functional, not decorative.
        sand: {
          50: "#FBFAF6",
          100: "#F4F1E7",
          200: "#E8E2D0",
          300: "#D5CBA9",
          400: "#B9A874",
          500: "#9A8650",
        },
        leaf: {
          50: "#EDF4ED",
          100: "#CFE0CF",
          200: "#A8C8A8",
          300: "#7BA97B",
          400: "#558555",
          500: "#3F6840",
          600: "#2C4B2D",
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
