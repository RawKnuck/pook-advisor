import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Pook Advisor",
  description: "Strategic counsel grounded in Inner Game, Masculinity, and The Book of Pook.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
