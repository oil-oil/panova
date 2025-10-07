"use client";
import React from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Load Monaco DiffEditor only on client
const DiffEditor = dynamic(() => import("@monaco-editor/react").then(m => m.DiffEditor), { ssr: false }) as any;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean)=>void;
  title: string;
  description?: string;
  before: string;
  after: string;
  language?: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
};

export default function DiffDialog(props: Props) {
  const { open, onOpenChange, title, description, before, after, language = 'markdown', onCancel, onConfirm, confirmText = '确认应用', cancelText = '取消' } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-[860px] max-w-[1200px] h-[80vh] p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-3 pb-2 border-b bg-card/60">
          <DialogTitle>{title}</DialogTitle>
          {description ? (<DialogDescription>{description}</DialogDescription>) : null}
        </DialogHeader>
        <div className="h-[calc(80vh-110px)]">
          {/* Monaco Diff Editor */}
          <DiffEditor
            original={before}
            modified={after}
            language={language}
            options={{
              readOnly: true,
              renderSideBySide: true,
              automaticLayout: true,
              wordWrap: 'on',
              minimap: { enabled: false },
              lineNumbers: 'on',
            }}
            theme="vs"
            height="100%"
          />
        </div>
        <DialogFooter className="px-4 py-3 border-t bg-background flex justify-end gap-2">
          <button type="button" className="h-8 px-3 rounded border bg-muted hover:bg-muted/80 text-sm" onClick={onCancel}>{cancelText}</button>
          <button type="button" className="h-8 px-3 rounded border bg-primary text-primary-foreground hover:opacity-90 text-sm" onClick={onConfirm}>{confirmText}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

