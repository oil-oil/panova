// Drag-n-drop visual/geometry config per mode

export type TreeMode = "nested" | "flat";

export const INDENT_NESTED = 16; // px per depth in nested mode
export const INDENT_FLAT = 28;   // px per depth in flat mode (airier)

export function getIndentStep(mode: TreeMode) {
  return mode === "flat" ? INDENT_FLAT : INDENT_NESTED;
}

// Region thresholds (portion of row height)
export const REGION_THRESHOLDS = {
  nested: { top: 0.3, bottom: 0.3 },
  flat: { top: 0.35, bottom: 0.35 },
} as const;

// Horizontal hysteresis to avoid depth jitter when dragging
export const HYSTERESIS = { up: 0.6, down: 0.4 } as const;

// Auto-expand delays (ms)
export const AUTO_EXPAND_DELAY = {
  nested: 450,
  flat: 350,
} as const;

// Flat mode visuals
export const FLAT_PAD_BASE = 14; // px (matches px-3 with a tiny bias)

