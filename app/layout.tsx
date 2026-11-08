import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { UpgradeDialogProvider } from "@/components/billing/upgrade-dialog";
import { AuthProvider } from "@/lib/auth-client";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "AppForge — Build mobile apps with AI",
  description:
    "Describe your idea and AppForge's AI agent designs and builds your iOS and Android app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="antialiased">
        <AuthProvider>
          <UpgradeDialogProvider>{children}</UpgradeDialogProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
