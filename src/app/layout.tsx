import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Suspense } from "react";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import { NavTracker } from "@/components/nav/NavTracker";
import { BRAND } from "@/config/brand";
import { LOCALE } from "@/config/seo";
import { siteOrigin } from "@/config/site-origin";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap", axes: ["SOFT", "opsz"] });

const SITE_URL = siteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  applicationName: BRAND.name,
  description: BRAND.description,
  category: "finance",
  robots: { index: true, follow: true },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    siteName: BRAND.name,
    description: BRAND.description,
    type: "website",
    locale: LOCALE,
  },
  twitter: { card: "summary_large_image", title: `${BRAND.name} — ${BRAND.tagline}`, description: BRAND.description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Light is the server-rendered default; the init script switches to the
    // stored theme before paint. suppressHydrationWarning covers that attribute.
    <html lang="en-IN" data-theme="light" suppressHydrationWarning className={`${hanken.variable} ${fraunces.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}
        <Suspense fallback={null}>
          <NavTracker />
        </Suspense>
        <Analytics />
      </body>
    </html>
  );
}
