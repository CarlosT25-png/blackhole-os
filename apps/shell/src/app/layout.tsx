import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
});

export const metadata: Metadata = {
  title: "Blackhole",
  description: "Blackhole OS kiosk shell",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={bricolage.variable}
      style={{ background: "#06070b", colorScheme: "dark" }}
    >
      <body style={{ fontFamily: "var(--font-bricolage), system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
