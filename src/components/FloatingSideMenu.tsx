"use client";

import React from "react";
import { useRouter } from "next/router";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ListTree, FileText } from "lucide-react";

type MenuItem = {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

// Minimal floating, icon-only side menu fixed to the right.
// Uses tooltips for labels and router.push for navigation.
export function FloatingSideMenu() {
  const router = useRouter();

  const items = React.useMemo<MenuItem[]>(
    () => [
      { key: "features", label: "特性树", href: "/features", icon: ListTree },
      { key: "docs", label: "文档", href: "/docs", icon: FileText },
    ],
    [],
  );

  const activePath = router.pathname;

  const onNavigate = (href: string) => {
    if (href !== activePath) void router.push(href);
  };

  return (
    <aside
      className="fixed top-0 right-0 h-screen z-40 border-r bg-card/80 backdrop-blur-sm"
      aria-hidden={false}
    >
      <nav
        className="w-12 h-full flex flex-col items-center gap-2 py-3"
        role="navigation"
        aria-label="侧边快捷菜单"
      >
        {items.map(({ key, label, href, icon: Icon }) => {
          const active = activePath === href;
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => onNavigate(href)}
                  className={cn(
                    "h-7 w-7 rounded-md border transition-colors flex items-center justify-center cursor-pointer",
                    active
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-background hover:bg-muted border-border text-foreground/70",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={8}>
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}

export default FloatingSideMenu;
