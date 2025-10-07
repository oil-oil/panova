"use client";

import React from "react";

export const PROD_CHIP_CLASS = "inline-flex items-center rounded-sm border px-1 py-0.5 bg-sky-50 text-sky-700 border-sky-600/30 whitespace-nowrap align-baseline text-xs mr-1";

export function ProdChip({ label }: { label: string }) {
  return (
    <span className={PROD_CHIP_CLASS} data-prod-mention>
      <span className="opacity-80 mr-0.5">@</span>
      <span>{label}</span>
    </span>
  );
}

