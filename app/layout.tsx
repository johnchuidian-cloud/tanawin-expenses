import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tanawin Operating Expenses",
  description: "Operating expense tracker for Tanawin Bed and Breakfast",
  // Home-screen install: the manifest gives Android the app name, the
  // Tanawin icon, and full-screen (no address bar) standalone display;
  // appleWebApp + the apple touch icon do the same for iPhones.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Tanawin Expenses",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // prevent zoom on input focus (iOS habit)
  themeColor: "#9A3518", // brand maroon
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
