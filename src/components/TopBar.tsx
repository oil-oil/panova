"use client";

import React from "react";
import TopTabs from "@/components/TopTabs";

export default function TopBar() {
  return (
    <header className="fixed top-0 inset-x-0 h-12 z-40 border-b border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div className="h-full mx-auto w-full max-w-[840px] px-4 flex items-center">
        <TopTabs />
      </div>
    </header>
  );
}

