"use client";

import React from "react";
import { useRouter } from "next/router";
import { ListTree, BookTextIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Tab = { key: string; href: string; label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> };

const TABS: Tab[] = [
  { key: "features", href: "/features", label: "特性树", icon: ListTree },
  { key: "docs", href: "/docs", label: "文档库", icon: BookTextIcon },
];

export function TopTabs({ className }: { className?: string }) {
  const router = useRouter();
  const [active, setActive] = React.useState<string>("features");
  React.useEffect(() => {
    try { const v = window.localStorage.getItem("panova.topTabs.active"); if (v) setActive(v); } catch {}
  }, []);
  const onSelect = (key: string, href: string) => {
    setActive(key);
    try { window.localStorage.setItem("panova.topTabs.active", key); } catch {}
    if (router.pathname !== href) void router.push(href);
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-1">
        {TABS.map((t) => {
          const isActive = active === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(t.key, t.href)}
              className={cn(
                "relative px-2 py-1 text-xs rounded-md transition-colors cursor-pointer",
                isActive ? "text-foreground" : "text-foreground/70 hover:text-foreground",
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={`tabs-pill-${active}`}
                  className="absolute inset-0 rounded-md bg-white"
                  initial={{ opacity: 0.9, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.6 }}
                />
              )}
              <span className="relative inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TopTabs;
