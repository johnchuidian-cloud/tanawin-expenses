import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tanawin Operating Expenses",
  description: "Operating expense tracker for Tanawin Bed and Breakfast",
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
