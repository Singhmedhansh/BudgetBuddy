import { BRAND } from "@/config/brand";
import OpenGraphImage from "./opengraph-image";

// Next reads these exports statically, so they are written as literals here rather than re-exported.
export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default OpenGraphImage;
