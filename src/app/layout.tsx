import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Allied Development — Entity Skip Trace Pipeline",
  description: "Developing Land, Growing Legacies — Process entity CSVs through Clay AI agents to resolve LLC/trust owners",
  icons: { icon: "/allied-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
