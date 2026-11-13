import { ImageResponse } from "next/og";
import { markSvg } from "@/components/brand/mark-geometry";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the FinTrack mark (same geometry as /icon.svg), rendered as a PNG. */
export default function AppleIcon() {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${markSvg()}</svg>`)}`;
  // eslint-disable-next-line @next/next/no-img-element
  return new ImageResponse(<img src={src} width={180} height={180} alt="" />, size);
}
