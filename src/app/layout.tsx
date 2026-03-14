import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Entity Skip Trace Pipeline",
  description: "Process entity CSVs through Clay AI agents to resolve LLC/trust owners",
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
