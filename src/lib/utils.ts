// Utility functions used across components
import { type ClassValue } from "clsx";
import { clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Simple id generator (timestamp + counter) to avoid external deps
let __idCounter = 0;
export function genId(prefix = "n"): string {
  __idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${__idCounter.toString(36)}`;
}

// Clamp value between min and max
export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

