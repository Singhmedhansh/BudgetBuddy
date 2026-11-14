import { ImageResponse } from "next/og";
import { markSvg } from "@/components/brand/mark-geometry";
import { BRAND } from "@/config/brand";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social preview: the FinTrack mark and wordmark, the tagline and the domain, on the brand's deep green. */
export default function OpenGraphImage() {
  const mark = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${markSvg()}</svg>`)}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 88px", background: "linear-gradient(135deg, #0b2119 0%, #123a2b 55%, #1d5a43 100%)", color: "#f7f7f2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={96} height={96} alt="" />
          <div style={{ display: "flex", fontSize: 64, letterSpacing: -1.5 }}>
            <span style={{ fontWeight: 500, color: "#8fd1ae" }}>Fin</span>
            <span style={{ fontWeight: 800 }}>Track</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>{BRAND.tagline}</div>
          <div style={{ marginTop: 28, fontSize: 34, color: "#b9d9c6", maxWidth: 880, lineHeight: 1.3 }}>Budgets, bills, goals and a ledger that balances.</div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#8fd1ae" }}>getfintrack.online</div>
      </div>
    ),
    size,
  );
}
