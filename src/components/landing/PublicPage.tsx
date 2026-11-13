import { SiteFooter, SiteHeader } from "./SiteChrome";

/** Shared frame for public pages: header, main landmark, footer. */
export function PublicPage({ children, width = "max-w-3xl" }: { children: React.ReactNode; width?: string }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className={`mx-auto ${width} px-5 py-12 sm:py-16`}>{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
