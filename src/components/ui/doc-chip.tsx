"use client";

import React from "react";

export const DOC_CHIP_CLASS = "inline-flex items-center rounded-sm border px-1 py-0.5 bg-teal-50 text-teal-700 border-teal-600/30 whitespace-nowrap align-baseline text-xs mr-1";

export function DocChip({ label }: { label: string }) {
  return (
    <span className={DOC_CHIP_CLASS} data-doc-mention>
      <span className="opacity-80 mr-0.5">@</span>
      <span>{label}</span>
    </span>
  );
}

