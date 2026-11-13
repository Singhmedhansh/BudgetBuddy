import { ImageResponse } from "next/og";
import { BRAND } from "@/config/brand";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#0f2a20", color: "#f7f7f2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="120" height="120" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#6cc29b" />
            <path d="M11 24.5V9.5h8.5M11 16.2h5.5" fill="none" stroke="#0c1a13" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="23" cy="9.5" r="2.6" fill="#0c1a13" />
            <circle cx="20" cy="16.2" r="1.9" fill="#0c1a13" />
          </svg>
          <div style={{ fontSize: 104, fontWeight: 600, letterSpacing: -3 }}>FinTrack</div>
        </div>
        <div style={{ marginTop: 48, fontSize: 52, color: "#a9cdb9" }}>{BRAND.tagline}</div>
      </div>
    ),
    size,
  );
}
