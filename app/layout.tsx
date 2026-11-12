import "./globals.css";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";

import { UpgradeDialogProvider } from "@/components/billing/upgrade-dialog";
import { AuthProvider } from "@/lib/auth-client";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Dreamera — Your dream. Our AI. Your creation.",
  description:
    "Got a dream app in mind? Describe it and Dreamera's AI helps you design, build, and bring it to life. No coding expertise required.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} scroll-smooth`}>
      <body className="antialiased">
        <AuthProvider>
          <UpgradeDialogProvider>{children}</UpgradeDialogProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
