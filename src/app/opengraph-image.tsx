import { ImageResponse } from "next/og";
import { markSvg } from "@/components/brand/mark-geometry";
import { BRAND } from "@/config/brand";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const mark = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${markSvg()}</svg>`)}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#0f2a20", color: "#f7f7f2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={120} height={120} alt="" />
          <div style={{ fontSize: 104, fontWeight: 600, letterSpacing: -3 }}>FinTrack</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 52, color: "#a9cdb9" }}>{BRAND.tagline}</div>
      </div>
    ),
    size,
  );
}
