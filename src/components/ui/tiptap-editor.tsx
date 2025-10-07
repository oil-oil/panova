"use client";

import React from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from 'prosemirror-state';
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Strikethrough, Quote, Code2, Heading1, Heading2, Heading3, List, ListOrdered, Copy } from "lucide-react";
import { htmlToMarkdownWithTable, markdownToHtml } from "@/lib/markdown";
import { useToast } from "@/components/ui/toast";
import Placeholder from "@tiptap/extension-placeholder";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string; // applied to EditorContent (content area)
  containerClassName?: string; // applied to outer bordered container
  overlay?: React.ReactNode; // render absolute element inside container (e.g., send button)
  withToolbar?: boolean; // show minimal icon toolbar
  onEditorReady?: (editor: any) => void; // expose editor instance for advanced integrations (mentions, etc.)
  extraExtensions?: any[]; // extra Tiptap extensions (e.g., mentions)
  compact?: boolean; // compact spacing (for chat input)
  innerScrollClassName?: string; // optional inner scroll wrapper around EditorContent (keeps overlay fixed)
};

// Singleton extension: paste plain-text Markdown -> HTML
const MarkdownPasteExt = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    // Stable key avoids "Adding different instances of a keyed plugin" errors
    const key = new PluginKey('markdownPaste');
    const looksLikeMarkdown = (txt: string) => {
      const s = (txt || '').trim();
      if (!s) return false;
      if (/^#{1,6}\s/.test(s)) return true; // headings
      if (/^\s*[-*+]\s+/.test(s)) return true; // bullet list
      if (/^\s*\d+\.\s+/.test(s)) return true; // ordered list
      if (/```[\s\S]*```/.test(s)) return true; // fenced code
      if (/\|[^\n]*\|/.test(s) && /\n\s*\|\s*-{3,}/.test('\n'+s)) return true; // table pipes
      if (/\*\*[^*]+\*\*/.test(s) || /_[^_]+_/.test(s)) return true; // emphasis
      return false;
    };
    return [
      new Plugin({
        key,
        props: {
          handlePaste: (_view, event: ClipboardEvent) => {
            try {
              const dt = event.clipboardData; if (!dt) return false;
              const html = dt.getData('text/html');
              const text = dt.getData('text/plain');
              // If HTML exists, let default HTML paste flow
              if (html && html.trim()) return false;
              if (!text || !looksLikeMarkdown(text)) return false;
              event.preventDefault();
              const htmlOut = markdownToHtml(text);
              // Insert as HTML content at current selection
              (this.editor as any)?.commands?.insertContent?.(htmlOut);
              return true;
            } catch { return false; }
          },
        },
      })
    ];
  },
});

export function TiptapEditor({ value, onChange, className, containerClassName, placeholder, overlay, withToolbar, onEditorReady, extraExtensions, compact, innerScrollClassName }: Props) {
  // Minimal keyboard shortcuts similar to common editors
  const Shortcuts = React.useMemo(() => (Extension.create({
    name: "shortcuts",
    addKeyboardShortcuts() {
      return {
        // Bold / Italic / Strike
        "Mod-b": () => (this.editor as any).commands.toggleBold(),
        "Mod-i": () => (this.editor as any).commands.toggleItalic(),
        "Mod-Shift-x": () => (this.editor as any).commands.toggleStrike(),
        // Blockquote
        "Mod-Shift-q": () => (this.editor as any).commands.toggleBlockquote(),
        // Inline code / Code block
        "Mod-`": () => (this.editor as any).commands.toggleCode(),
        "Mod-Alt-c": () => (this.editor as any).commands.toggleCodeBlock(),
        // Headings
        "Mod-Alt-1": () => (this.editor as any).commands.toggleHeading({ level: 1 }),
        "Mod-Alt-2": () => (this.editor as any).commands.toggleHeading({ level: 2 }),
        "Mod-Alt-3": () => (this.editor as any).commands.toggleHeading({ level: 3 }),
        // Lists
        "Mod-Shift-8": () => (this.editor as any).commands.toggleBulletList(),
        "Mod-Shift-7": () => (this.editor as any).commands.toggleOrderedList(),
      };
    },
  }) as any), []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Shortcuts,
      // Paste plain-text Markdown as formatted HTML
      MarkdownPasteExt as any,
      // Enable table nodes so pasted/设置的 HTML 中的 <table> 能被解析与展示
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ...(placeholder ? [Placeholder.configure({ placeholder, includeChildren: true })] : []),
      ...(extraExtensions || []),
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: cn(
          "tiptap prose prose-xs max-w-none focus:outline-none",
          compact ? "tiptap-compact min-h-[20px]" : "min-h-[100px]",
          className,
        ),
      },
    },
    immediatelyRender: false,
  });

  // Expose editor instance once ready
  React.useEffect(() => {
    if (editor && typeof onEditorReady === 'function') onEditorReady(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editor]);

  // Sync external value into editor when it changes (first open bug fix)
  React.useEffect(() => {
    if (!editor) return;
    const html = value || "";
    // Avoid loop by only setting when different
    if (html !== editor.getHTML()) {
      editor.commands.setContent(html);
    }
  }, [value, editor]);

  const { show: showToast } = useToast();

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className={cn("rounded-sm border bg-background relative", containerClassName)}>
        {withToolbar && editor ? (
          <div className="flex items-center gap-1 border-b border-border/40 p-1 sticky top-0 z-10 bg-background">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('bold') && "bg-muted")}
              title="加粗 (Cmd/Ctrl+B)" onClick={() => (editor as any).chain().focus().toggleBold().run()}>
              <Bold className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('italic') && "bg-muted")}
              title="斜体 (Cmd/Ctrl+I)" onClick={() => (editor as any).chain().focus().toggleItalic().run()}>
              <Italic className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('strike') && "bg-muted")}
              title="删除线 (Cmd/Ctrl+Shift+X)" onClick={() => (editor as any).chain().focus().toggleStrike().run()}>
              <Strikethrough className="h-4 w-4" />
            </Button>
            <div className="mx-1 w-px self-stretch bg-border" />
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('blockquote') && "bg-muted")}
              title="引用 (Cmd/Ctrl+Shift+Q)" onClick={() => (editor as any).chain().focus().toggleBlockquote().run()}>
              <Quote className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('codeBlock') && "bg-muted")}
              title="代码块 (Cmd/Ctrl+Alt+C)" onClick={() => (editor as any).chain().focus().toggleCodeBlock().run()}>
              <Code2 className="h-4 w-4" />
            </Button>
            <div className="mx-1 w-px self-stretch bg-border" />
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('heading', { level: 1 }) && "bg-muted")}
              title="标题 1 (Cmd/Ctrl+Alt+1)" onClick={() => (editor as any).chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('heading', { level: 2 }) && "bg-muted")}
              title="标题 2 (Cmd/Ctrl+Alt+2)" onClick={() => (editor as any).chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('heading', { level: 3 }) && "bg-muted")}
              title="标题 3 (Cmd/Ctrl+Alt+3)" onClick={() => (editor as any).chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 className="h-4 w-4" />
            </Button>
            <div className="mx-1 w-px self-stretch bg-border" />
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('bulletList') && "bg-muted")}
              title="无序列表 (Cmd/Ctrl+Shift+8)" onClick={() => (editor as any).chain().focus().toggleBulletList().run()}>
              <List className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 cursor-pointer", editor.isActive('orderedList') && "bg-muted")}
              title="有序列表 (Cmd/Ctrl+Shift+7)" onClick={() => (editor as any).chain().focus().toggleOrderedList().run()}>
              <ListOrdered className="h-4 w-4" />
            </Button>
            <div className="mx-1 w-px self-stretch bg-border" />
            {/* Copy current content as Markdown */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              title="复制为 Markdown"
              aria-label="复制为 Markdown"
              onClick={async () => {
                try {
                  const html = editor.getHTML();
                  const md = htmlToMarkdownWithTable(html);
                  await navigator.clipboard.writeText(md);
                  showToast({ title: "已复制", description: "文档内容已复制为 Markdown", variant: "success" });
                } catch (e) {
                  showToast({ title: "复制失败", description: (e as Error)?.message || "无法写入剪贴板", variant: "error" });
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {innerScrollClassName ? (
          <div className={cn("relative", innerScrollClassName)}>
            <EditorContent editor={editor} className="px-1.5 py-1" />
          </div>
        ) : (
          <EditorContent editor={editor} className="relative px-1.5 py-1" />
        )}
        {overlay ? (<div className="absolute right-2 bottom-2">{overlay}</div>) : null}
      </div>
    </div>
  );
}
