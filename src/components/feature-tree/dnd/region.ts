import type { TreeMode } from "./config";

export type Region = "before" | "inside" | "after";

// Accept a minimal rect shape to avoid DOMRect vs ClientRect typing issues
export function computeRegion(
  overRect: { top: number; bottom: number; height: number },
  pointerY: number,
  mode: TreeMode,
): Region {
  // Use fixed pixel pads near top/bottom so hit-zones stay stable regardless of row height.
  // This matches Notion-like feel: easy to target the gaps even for tall rows.
  const cap = mode === "flat" ? 12 : 10; // px
  const pad = Math.min(cap, overRect.height * 0.33); // never exceed 1/3 of row height
  const yTop = overRect.top + pad;
  const yBot = overRect.bottom - pad;
  if (pointerY < yTop) return "before";
  if (pointerY > yBot) return "after";
  return "inside";
}
