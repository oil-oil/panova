"use client";

import React from "react";

type ToastItem = {
  id: string;
  title?: string;
  description?: string;
  variant?: "success" | "error" | "info";
  duration?: number; // ms
};

type ToastCtx = {
  show: (t: Omit<ToastItem, "id">) => string;
  remove: (id: string) => void;
};

const Ctx = React.createContext<ToastCtx | null>(null);

function genId() { return `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`; }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<string, any>());

  const remove = React.useCallback((id: string) => {
    setList((prev) => prev.filter((t) => t.id !== id));
    const tm = timers.current.get(id); if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const show = React.useCallback((t: Omit<ToastItem, "id">) => {
    const id = genId();
    const item: ToastItem = { id, duration: 2200, variant: "info", ...t };
    setList((prev) => [...prev, item]);
    const tm = setTimeout(() => remove(id), item.duration);
    timers.current.set(id, tm);
    return id;
  }, [remove]);

  const value = React.useMemo<ToastCtx>(() => ({ show, remove }), [show, remove]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Container */}
      <div className="fixed right-4 top-4 z-[9999] flex flex-col gap-2">
        {list.map((t) => (
          <div
            key={t.id}
            className={
              "min-w-[220px] max-w-[360px] rounded-md border px-3 py-2 text-sm shadow-lg bg-card " +
              (t.variant === "success" ? "border-emerald-300 text-emerald-900 bg-emerald-50" :
               t.variant === "error" ? "border-red-300 text-red-900 bg-red-50" :
               "border-border text-foreground")
            }
          >
            {t.title ? <div className="font-medium mb-0.5">{t.title}</div> : null}
            {t.description ? <div className="text-[13px] opacity-90">{t.description}</div> : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

