/**
 * FinTrack mark geometry (32x32 grid), traced from the approved logo artwork in
 * public/brand/fintrack-logo-source.png: a folded "F" in ivory and sage on a deep
 * green tile, with a three-point trend line running through it. Shared by the
 * React logo, the app icons and the social image so they cannot drift apart.
 */
export const MARK = {
  tile: "#0b4a35",
  bar: "#f6f5e6",
  stem: "#c5dbb8",
  panel: "#3f8a63",
  barPath: "M12.4 6.4H26.9L24.6 10.3H12.9C10.5 10.3 8.6 11.4 7.3 13C7.6 9.2 9.4 6.4 12.4 6.4Z",
  stemPath: "M7.3 12.8H12.9L9.2 27.2H4.5Z",
  panelPath: "M12.9 16.7L23.8 16.1L20.9 22.1H11.4Z",
  linePath: "M9.2 20.6L16.8 17.4L25.1 14.1",
  nodes: [
    [9.2, 20.6, 1.9],
    [16.8, 17.4, 1.8],
    [25.1, 14.1, 1.9],
  ],
} as const;

/** The mark as a standalone SVG string (static files, favicon). */
export function markSvg(): string {
  const n = MARK.nodes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${MARK.bar}"/>`).join("");
  return `<rect width="32" height="32" rx="8.5" fill="${MARK.tile}"/><path d="${MARK.panelPath}" fill="${MARK.panel}"/><path d="${MARK.stemPath}" fill="${MARK.stem}"/><path d="${MARK.barPath}" fill="${MARK.bar}"/><path d="${MARK.linePath}" fill="none" stroke="${MARK.bar}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>${n}`;
}
