import type { Metadata } from "next";
import { Suspense } from "react";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import { NavTracker } from "@/components/nav/NavTracker";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap", axes: ["SOFT", "opsz"] });

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
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${hanken.variable} ${fraunces.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}
        <Suspense fallback={null}>
          <NavTracker />
        </Suspense>
      </body>
    </html>
  );
}
