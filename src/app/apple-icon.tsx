import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the FinTrack mark on forest green, same geometry as /icon.svg. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#245c48" }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path d="M11 24.5V9.5h8.5M11 16.2h5.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="23" cy="9.5" r="2.6" fill="#dce9df" />
          <circle cx="20" cy="16.2" r="1.9" fill="#fff" />
        </svg>
      </div>
    ),
    size,
  );
}
