"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { BotMessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

const ChatDock = dynamic(() => import("@/components/ai/ChatDock"), { ssr: false });

// Global sticky chat button + dock. CSS transitions for now; can swap to framer-motion later.
export function GlobalChat() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Dock with framer-motion */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-dock"
            className={cn("fixed right-4 bottom-4 z-50")}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.6 }}
          >
            <div className="w-[min(92vw,440px)] h-[680px] rounded-lg border bg-card overflow-hidden shadow-sm ring-1 ring-black/2">
              <ChatDock className="h-full" onClose={() => setOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB */}
      <div className="fixed right-4 bottom-4 z-40">
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full bg-white border shadow-sm hover:shadow-md cursor-pointer"
          onClick={() => setOpen(!open)}
          aria-label="Panova Copilot"
          title="Panova Copilot"
        >
          <BotMessageSquare className="h-5 w-5" />
        </Button>
      </div>
    </>
  );
}

export default GlobalChat;
