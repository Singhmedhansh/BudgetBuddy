import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Budget Buddy: personal finance, in one place", template: "%s | Budget Buddy" },
  description:
    "Track expenses, plan budgets, manage subscriptions and understand your finances in one place.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Budget Buddy",
    description: "Track expenses, plan budgets, manage subscriptions and understand your finances in one place.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Light is the server-rendered default; the init script switches to the
    // stored theme before paint. suppressHydrationWarning covers that attribute.
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${hanken.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
