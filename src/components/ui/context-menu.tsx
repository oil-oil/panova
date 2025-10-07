"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  children: React.ReactNode;
  items: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }>;
}

export function ContextMenu({ children, items }: ContextMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const menuRef = React.useRef<HTMLDivElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setPosition({ x: e.clientX, y: e.clientY });
    setIsOpen(true);
  };

  const handleClick = () => {
    setIsOpen(false);
  };

  const handleItemClick = (onClick: () => void) => {
    onClick();
    setIsOpen(false);
  };

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <>
      <div onContextMenu={handleContextMenu} onClick={handleClick}>
        {children}
      </div>
      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[120] min-w-[160px] rounded-md border bg-popover p-1 text-popover-foreground shadow-xs"
          style={{ left: position.x, top: position.y }}
        >
          {items.map((item, index) => (
            <button
              key={index}
              className={cn(
                "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
                "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                item.disabled && "pointer-events-none opacity-50",
              )}
              onClick={() => handleItemClick(item.onClick)}
              disabled={item.disabled}
            >
              {item.icon && <span className="mr-2 h-4 w-4">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
