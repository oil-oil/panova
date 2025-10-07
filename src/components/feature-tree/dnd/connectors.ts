import { FLAT_PAD_BASE } from "./config";
import type { CSSProperties } from "react";

// Build layered-gradient CSS for flat-mode tree connectors.
// ancestors: list of ancestor ids (root..parent), depth: current depth
export function buildFlatConnectorStyle(args: {
  ancestors: string[];
  isLastOf: (id: string) => boolean;
  depth: number;
  indent: number;
}): CSSProperties {
  const { ancestors, isLastOf, depth, indent } = args;
  const padBase = FLAT_PAD_BASE;
  const lineOffset = Math.floor(indent / 2);
  const bgImg: string[] = [];
  const bgPos: string[] = [];
  const bgSize: string[] = [];
  const bgRep: string[] = [];

  // vertical rails for ancestors that are not last
  ancestors.forEach((aid, i) => {
    if (!isLastOf(aid)) {
      bgImg.push(
        "repeating-linear-gradient(to bottom, currentColor 0 2px, transparent 2px 6px)",
      );
      bgPos.push(`${padBase + i * indent + lineOffset}px 0`);
      bgSize.push("1px 100%");
      bgRep.push("no-repeat");
    }
  });
  // horizontal elbow for current node
  if (depth > 0) {
    const curX = padBase + (depth - 1) * indent + lineOffset; // from parent rail center
    const segW = indent; // reach to current node cell
    bgImg.push("repeating-linear-gradient(to right, currentColor 0 2px, transparent 2px 6px)");
    bgPos.push(`${curX}px 50%`);
    bgSize.push(`${segW}px 1px`);
    bgRep.push("no-repeat");
  }

  return {
    paddingLeft: padBase + depth * indent,
    backgroundImage: bgImg.join(", "),
    backgroundPosition: bgPos.join(", "),
    backgroundSize: bgSize.join(", "),
    backgroundRepeat: bgRep.join(", "),
  } as CSSProperties;
}

// Placeholder style for before/after in flat mode (elbow only, at depth)
export function buildFlatPlaceholderStyle(args: {
  ancestors: string[];
  isLastOf: (id: string) => boolean;
  depth: number;
  indent: number;
}): CSSProperties {
  const { ancestors, isLastOf, depth, indent } = args;
  const padBase = FLAT_PAD_BASE;
  const lineOffset = Math.floor(indent / 2);

  const bgImg: string[] = [];
  const bgPos: string[] = [];
  const bgSize: string[] = [];
  const bgRep: string[] = [];

  ancestors.forEach((aid, i) => {
    if (!isLastOf(aid)) {
      bgImg.push("repeating-linear-gradient(to bottom, currentColor 0 2px, transparent 2px 6px)");
      bgPos.push(`${padBase + i * indent + lineOffset}px 0`);
      bgSize.push("1px 100%");
      bgRep.push("no-repeat");
    }
  });
  if (depth > 0) {
    const curX = padBase + (depth - 1) * indent + lineOffset;
    const segW = indent;
    bgImg.push("repeating-linear-gradient(to right, currentColor 0 2px, transparent 2px 6px)");
    bgPos.push(`${curX}px 50%`);
    bgSize.push(`${segW}px 1px`);
    bgRep.push("no-repeat");
  }
  return {
    paddingLeft: padBase + depth * indent,
    backgroundImage: bgImg.join(", "),
    backgroundPosition: bgPos.join(", "),
    backgroundSize: bgSize.join(", "),
    backgroundRepeat: bgRep.join(", "),
  } as CSSProperties;
}
