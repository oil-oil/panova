"use client";

import React from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useSensor, useSensors } from "@dnd-kit/core";
// line-only mode: use core draggable/droppable instead of sortable transforms
import { useDraggable, useDroppable } from "@dnd-kit/core";
 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, genId } from "@/lib/utils";
  import {
    addChildAtom,
    addSiblingBelowAtom,
    collapseAllAtom,
    expandAllAtom,
    flattenTree,
    getChildren,
    getProjection,
    nodesAtom,
    renameNodeAtom,
    toggleCollapseAtom,
    type FeatureNode,
    type FeatureStatus,
    activeIdAtom,
    draggingOffsetXAtom,
    editingIdAtom,
    editingDetailIdAtom,
    moveNodeAtom,
    deleteNodeAtom,
    searchQueryAtom,
    getAncestorIds,
    selectedNodeIdAtom,
    updateNodeStatusAtom,
    updateNodeStatusCascadeAtom,
    updateNodeDescriptionAtom,
    overIdAtom,
    overRegionAtom,
    undoAtom,
    redoAtom,
    // product‑level atoms
    productsAtom,
    loadProductsAtom,
    loadNodesForCurrentProductAtom,
    selectedProductIdAtom,
    replaceAllNodesAtom,
  } from "@/lib/feature-tree-atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronRight, ChevronDown, Pencil, Plus, Trash, PlusCircle, FoldVertical, UnfoldVertical, FileText, Copy, ListTree, Upload, ImportIcon, Check } from "lucide-react";
import { getIndentStep, INDENT_FLAT, INDENT_NESTED } from "./dnd/config";
import { computeRegion } from "./dnd/region";
import { buildFlatConnectorStyle, buildFlatPlaceholderStyle } from "./dnd/connectors";
import Editor from "@monaco-editor/react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { ContextMenu } from "@/components/ui/context-menu";
import { TiptapEditor } from "@/components/ui/tiptap-editor";
import { htmlToMarkdownWithTable, markdownToHtml } from "@/lib/markdown";
// Chat moved to page layout; no direct import here

// Indentation width per depth level (px)
const INDENT = 16; // legacy; will be replaced by mode-aware indent step
// const EDGE_PX = 24; // no longer used; kept here for possible future fine‑tuning of edge zones

// Status configuration - single pill, explicit tailwind colors (avoid global override)
const statusConfig: Record<FeatureStatus, { label: string; cls: string }> = {
  implemented: { label: "已实现", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  developing: { label: "开发中", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  pending: { label: "待开发", cls: "bg-sky-100 text-sky-800 border-sky-200" },
};

// nextStatus no longer used

export function FeatureTree() {
  const nodes = useAtomValue(nodesAtom);
  const products = useAtomValue(productsAtom);
  const selectedPid = useAtomValue(selectedProductIdAtom);
  const setSelectedPid = useSetAtom(selectedProductIdAtom);
  const loadProducts = useSetAtom(loadProductsAtom);
  const loadNodes = useSetAtom(loadNodesForCurrentProductAtom);
  const [activeId, setActiveId] = useAtom(activeIdAtom);
  const setOffsetX = useSetAtom(draggingOffsetXAtom);
  const setMove = useSetAtom(moveNodeAtom);
  const [query, setQuery] = useAtom(searchQueryAtom);
  const setOverId = useSetAtom(overIdAtom);
  const setOverRegion = useSetAtom(overRegionAtom);
  const [overlayWidth, setOverlayWidth] = React.useState<number | null>(null);
  const [rootParent] = useAutoAnimate({ duration: 180, easing: "ease-out" });
  // Delay attaching auto-animate until after first paint to avoid initial load animations
  const [animReady, setAnimReady] = React.useState(false);
  React.useEffect(() => { setAnimReady(true); }, []);
  React.useEffect(() => { loadProducts(); }, [loadProducts]);
  React.useEffect(() => {
    if (!products || products.length === 0) return;
    if (!selectedPid || !products.some(p=>p.id===selectedPid)) {
      setSelectedPid(products[0].id);
    } else {
      loadNodes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, selectedPid]);
  const [flatMode, setFlatMode] = React.useState(false);
  // Track pointer offset within the dragged element to align insert indicator with the real cursor
  const pointerOffsetYRef = React.useRef(0);
  // Perf: cache last drag computations to avoid redundant state updates
  const lastOverIdRef = React.useRef<string | null>(null);
  const lastRegionRef = React.useRef<"before" | "inside" | "after" | null>(null);
  const lastProjRef = React.useRef<{ depth: number; parentId: string | null; insertIndex: number } | null>(null);
  const scrollRafRef = React.useRef<number | null>(null);

  // 在搜索时强制展开包含匹配项的祖先，确保嵌套子级可见
  const forceOpenSet = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null as Set<string> | null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.title.toLowerCase().includes(q)) {
        for (const aid of getAncestorIds(nodes, n.id)) set.add(aid);
      }
    }
    return set;
  }, [nodes, query]);

  const flattened = React.useMemo(() => flattenTree(nodes, forceOpenSet ?? undefined), [nodes, forceOpenSet]);
  // const offsetX = useAtomValue(draggingOffsetXAtom);
  // const overRegionVal = useAtomValue(overRegionAtom);
  // 单一投影数据，驱动所有插入线渲染
  const [projection, setProjection] = React.useState<{
    depth: number;
    parentId: string | null;
    insertIndex: number;
  } | null>(null);

  // markdown panel state
  const [mdOpen, setMdOpen] = React.useState(false);
  const [mdText, setMdText] = React.useState("");
  const [mdCopied, setMdCopied] = React.useState(false);
  const [mdImportOpen, setMdImportOpen] = React.useState(false);
  const { show: showToast } = useToast();
  const doReplaceAll = useSetAtom(replaceAllNodesAtom);

  // Legacy AI drawer removed; Panova Copilot is provided via ChatDock in page layout

  // Chat dock moved to page layout; no local state needed

  // markdown helpers moved to src/lib/markdown.ts

  function toMarkdown(all: typeof nodes) {
    const sortSibs = (pid: string|null) => all.filter(n=>n.parentId===pid).sort((a,b)=>a.order-b.order);
    const lines: string[] = [];
    const walk = (pid: string|null, depth: number) => {
      for (const n of sortSibs(pid)) {
        const name = n.title && n.title.trim() ? n.title.trim() : "(未命名)";
        const indent = "  ".repeat(depth);
        lines.push(`${indent}- ${name}`);
        if (n.description && n.description.trim()) {
          const md = htmlToMarkdownWithTable(n.description);
          if (md) {
            // 若包含表格语法，则按原样插入（不使用 blockquote），否则使用引用样式
            const hasTable = /(^|\n)\s*\|.*\|\s*(\n|$)/.test(md) && /(\n)\s*\|\s*-{3,}/.test("\n"+md);
            if (hasTable) {
              lines.push("");
              for (const ln of md.split("\n")) lines.push(`${indent}  ${ln}`);
            } else {
              const descLines = md.split("\n");
              for (const ln of descLines) lines.push(`${indent}  > ${ln}`);
            }
          }
        }
        walk(n.id, depth+1);
      }
    };
    walk(null, 0);
    return lines.join("\n");
  }
  // Markdown -> FeatureNode[] importer. Supports:
  // - Nested bullet list using spaces (2 spaces per depth), markers '-'/'*'/'+'
  // - Optional description lines under an item:
  //   - blockquote lines starting with '>'
  //   - pipe tables (lines starting with '|')
  //   - indented text lines (indent >= base indent + 2)
  function parseMarkdownToNodes(md: string): FeatureNode[] {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out: FeatureNode[] = [];
    const childCount = new Map<string|null, number>();
    const stack: { depth: number; id: string; indentCols: number }[] = [];
    const INDENT_STEP = 2;
    function getOrder(pid: string|null) { const v = childCount.get(pid) ?? 0; childCount.set(pid, v+1); return v; }
    function parentIdForDepth(depth: number): string|null {
      if (depth <= 0) return null;
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].depth === depth - 1) return stack[i].id;
      return null;
    }
    function popToDepth(depth: number) { while (stack.length && stack[stack.length-1].depth >= depth) stack.pop(); }
    const isBullet = (s: string) => /^\s*[-*+]\s+/.test(s);
    const bulletMatch = (s: string) => s.match(/^(\s*)[-*+]\s+(.*)$/);
    const isBlockquote = (s: string) => /^\s*>\s*/.test(s);
    const isTableLine = (s: string) => /^\s*\|.*\|\s*$/.test(s);
    const indentCols = (s: string) => { const m = s.match(/^(\s*)/); const sp = (m?.[1]||'').replace(/\t/g,'  '); return sp.length; };
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g,'').replace(/-/g,'');
    const statusFromToken = (tok: string): FeatureStatus | null => {
      const k = norm(tok);
      if (["implemented","done","finish","finished","complete","completed","已实现","完成"].includes(k)) return "implemented";
      if (["developing","inprogress","wip","进行中","开发中"].includes(k)) return "developing";
      if (["pending","todo","notstarted","未开始","待开发"].includes(k)) return "pending";
      return null;
    };
    const extractStatus = (rawTitle: string) => {
      let t = rawTitle.trim();
      let st: FeatureStatus | null = null;
      // [状态] 标记（半角/全角）支持两侧
      const m1 = t.match(/^\s*[\[【]([^\]】]+)[\]】]\s*(.*)$/);
      const m2 = t.match(/^(.*)\s*[\[【]([^\]】]+)[\]】]\s*$/);
      if (m1) { const s = statusFromToken(m1[1]); if (s) { st = s; t = m1[2].trim(); } }
      else if (m2) { const s = statusFromToken(m2[2]); if (s) { st = s; t = m2[1].trim(); } }
      return { title: t, status: st } as const;
    };
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw.trim()) { i++; continue; }
      const m = bulletMatch(raw);
      if (!m) { i++; continue; }
      const cols = indentCols(m[1]); const depth = Math.max(0, Math.floor(cols / INDENT_STEP));
      let { title, status } = extractStatus(String(m[2] || ''));
      popToDepth(depth);
      const pid = parentIdForDepth(depth);
      const id = genId('f');
      const node: FeatureNode = { id, title, parentId: pid, order: getOrder(pid), status: status ?? 'pending', description: '' };
      out.push(node);
      stack.push({ depth, id, indentCols: cols });
      // collect following description lines
      const desc: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const s = lines[j];
        if (!s.trim()) { desc.push(''); j++; continue; }
        if (isBullet(s)) break; // next item starts
        const scols = indentCols(s);
        // blockquote under this item
        if (isBlockquote(s)) { desc.push(s.replace(/^\s*>\s?/, '')); j++; continue; }
        // tables: include raw
        if (isTableLine(s)) { desc.push(s.trim()); j++; continue; }
        // indented body (>= base+2)
        if (scols >= cols + INDENT_STEP) { desc.push(s.slice(cols + INDENT_STEP)); j++; continue; }
        break;
      }
      const mdBody = desc.join('\n').trim();
      if (mdBody) node.description = markdownToHtml(mdBody);
      i = j;
    }
    // normalize sibling order per parent
    const groups = new Map<string|null, FeatureNode[]>();
    for (const n of out) { const k = n.parentId ?? null; const arr = groups.get(k) ?? []; arr.push(n); groups.set(k, arr); }
    for (const [k, arr] of groups) arr.sort((a,b)=> a.order-b.order).forEach((n,idx)=> n.order = idx);
    return out;
  }
  // removed unused toAIJson helper (AI context is handled in src/lib/ai/context.ts)

  // ---------- AI helpers ----------
  // moved OpenRouter call to server API for logging & security
  // legacy AI helpers removed (migrated to ChatDock)

  // 搜索不再过滤结构，仅用于高亮匹配词
  // 保留 query 状态，但不生成可见集合（visible set）。

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Undo/Redo shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
  const doUndo = useSetAtom(undoAtom);
  const doRedo = useSetAtom(redoAtom);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const ctrl = isMac ? e.metaKey : e.ctrlKey;
      if (!ctrl) return;
      const tgt = e.target as HTMLElement | null;
      const tag = (tgt?.tagName || "").toUpperCase();
      const editable = !!(tgt && (tgt.isContentEditable || tag === "INPUT" || tag === "TEXTAREA"));
      if (editable) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
      } else if (key === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doUndo, doRedo]);

  // Prevent background scroll when any drawer open (Chat inline will not lock)
  React.useEffect(() => {
    const lock = mdOpen;
    const prev = document.body.style.overflow;
    if (lock) document.body.style.overflow = "hidden";
    else document.body.style.overflow = prev || "";
    return () => { document.body.style.overflow = prev || ""; };
  }, [mdOpen]);



  const onDragStart = (e: import("@dnd-kit/core").DragStartEvent) => {
    if (flatMode) return; // disable drag in flat mode
    setActiveId(e.active.id as string);
    setOffsetX(0);
    // measure the card width for overlay
    const el = document.querySelector(`[data-node-id="${String(e.active.id)}"]`) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      setOverlayWidth(r.width);
      // Compute pointer offset inside the element so region detection follows the actual cursor
      const ae = e.activatorEvent as any;
      let clientY: number | null = null;
      if (ae && typeof ae === "object") {
        if (typeof ae.clientY === "number") clientY = ae.clientY as number;
        else if (ae.touches && ae.touches[0]) clientY = ae.touches[0].clientY;
        else if (ae.changedTouches && ae.changedTouches[0]) clientY = ae.changedTouches[0].clientY;
      }
      if (clientY != null) pointerOffsetYRef.current = clientY - r.top;
      else pointerOffsetYRef.current = r.height / 2; // fallback
    }
    // reset drag caches
    lastOverIdRef.current = null;
    lastRegionRef.current = null;
    lastProjRef.current = null;
  };

  const onDragMove = (e: import("@dnd-kit/core").DragMoveEvent) => {
    if (flatMode) return; // disable drag in flat mode
    const overIdNow = (e.over?.id as string) ?? null;
    if (overIdNow !== lastOverIdRef.current) {
      setOverId(overIdNow);
      lastOverIdRef.current = overIdNow;
    }
    // 横向偏移用于可选缩进
    setOffsetX(e.delta.x);
    
    if (e.over && overIdNow && e.active) {
      // 获取实时位置
      const overRect = e.over.rect;
      const activeRect = e.active.rect.current?.translated;
      const mode: import("./dnd/config").TreeMode = flatMode ? "flat" : "nested";
      const indentStep = getIndentStep(mode);

      if (overRect && activeRect) {
        // 区域：基于指针/拖拽中心垂直位置
        const off = Math.max(0, Math.min(pointerOffsetYRef.current || activeRect.height / 2, activeRect.height));
        const pointerY = activeRect.top + off;
        const region = computeRegion(overRect, pointerY, mode);
        if (region !== lastRegionRef.current) {
          setOverRegion(region);
          lastRegionRef.current = region;
        }

        // 投影
        const overIdStr = String(e.over.id);
        const overItem = flattened.find(i => i.id === overIdStr);
        if (overItem) {
          // Guard: avoid projecting a node into itself when pointer is inside its own card
          if (overIdStr === String(e.active.id) && region === "inside") {
            setProjection(null);
            lastProjRef.current = null;
            return;
          }
          let nextProj: { depth: number; parentId: string | null; insertIndex: number } | null = null;
          if (region === "inside") {
            const childrenCount = getChildren(nodes, overIdStr).length;
            nextProj = { depth: (overItem.depth ?? 0) + 1, parentId: overIdStr, insertIndex: childrenCount };
          } else {
            nextProj = getProjection(
              flattened,
              String(e.active.id),
              overIdStr,
              e.delta.x,
              indentStep,
              nodes,
              region,
            );
          }
          const prev = lastProjRef.current;
          if (!prev || prev.depth !== nextProj.depth || prev.parentId !== nextProj.parentId || prev.insertIndex !== nextProj.insertIndex) {
            setProjection(nextProj);
            lastProjRef.current = nextProj;
          }
        }
      }
      
      // 自动滚动 - 基于拖拽元素位置
      const activeRectForScroll = e.active.rect.current?.translated;
      if (activeRectForScroll) {
        const activeCenterY = activeRectForScroll.top + activeRectForScroll.height / 2;
        const viewH = window.innerHeight;
        const scrollZone = 100;
        
        const scheduleScroll = (dy: number) => {
          if (scrollRafRef.current != null) return;
          scrollRafRef.current = requestAnimationFrame(() => {
            window.scrollBy({ top: dy });
            scrollRafRef.current = null;
          });
        };
        if (activeCenterY < scrollZone) scheduleScroll(-14);
        else if (activeCenterY > viewH - scrollZone) scheduleScroll(14);
      }
    } else {
      setOverRegion(null);
      setProjection(null);
    }
  };

  const onDragEnd = (e: import("@dnd-kit/core").DragEndEvent) => {
    if (flatMode) return; // disable drag in flat mode
    const { active, over } = e;
    const activeId = active.id as string;
    const finalProjection = projection;
    
    // 清理状态
    setActiveId(null);
    setOverId(null);
    setOverRegion(null);
    setOverlayWidth(null);
    setProjection(null);
    lastOverIdRef.current = null;
    lastRegionRef.current = null;
    lastProjRef.current = null;
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    
    if (!over) return;
    if (!finalProjection) return;

    const activeNode = nodes.find(n => n.id === activeId);
    if (!activeNode) return;

    // 阻止无效关系：自指 或 拖入自身后代
    const invalidParent = (parent: string, candidate: string | null): boolean => {
      if (!candidate) return false;
      if (candidate === parent) return true; // self-parenting
      const chain = getAncestorIds(nodes, candidate);
      return chain.includes(parent);
    };

    if (invalidParent(activeId, finalProjection.parentId)) return;

    setMove({
      id: activeId,
      newParentId: finalProjection.parentId,
      newIndex: Math.max(0, finalProjection.insertIndex),
    });
  };

  // Build tree roots to render recursively for nested container visuals
  const roots = React.useMemo(() => nodes.filter((n) => n.parentId === null).sort((a, b) => a.order - b.order), [nodes]);

  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  return (
    <div className="w-full max-w-[840px] mx-auto">
      <Toolbar 
        query={query} 
        setQuery={setQuery} 
        onShowMarkdown={() => { setMdText(toMarkdown(nodes)); setMdOpen(true); }}
        flatMode={flatMode}
        setFlatMode={setFlatMode}
      />
      <div className="">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
        >
          <TooltipProvider delayDuration={150}>
            {flattened.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-2" ref={animReady && !activeId ? rootParent : undefined}>
                {(() => {
                  // 不再按搜索过滤，仅用于高亮。
                  const list = roots;
                  const out: React.ReactNode[] = [];
                  const ph = projection && projection.parentId === null ? projection : null;

                  list.forEach((r, i) => {
                    if (ph && ph.insertIndex === i) out.push(
                      flatMode
                        ? <FlatPlaceholderRow key={`__ph_root_${i}`} depth={ph.depth} parentId={null} nodes={nodes} />
                        : <PlaceholderRow key={`__ph_root_${i}`} depth={ph.depth} base={0} indent={INDENT_NESTED} />
                    );
                    out.push(
                      <NodeBlock
                        key={r.id}
                        id={r.id}
                        depth={0}
                        projection={projection}
                        flatMode={flatMode}
                        animReady={animReady}
                        // flat 模式下完全禁用拖拽
                        dragDisabled={flatMode}
                        // 传入强制展开集合，确保匹配子项的父级打开
                        forceOpenSet={forceOpenSet ?? undefined}
                      />
                    );
                  });

                  if (ph && ph.insertIndex >= list.length) out.push(
                    flatMode
                      ? <FlatPlaceholderRow key="__ph_root_end" depth={ph.depth} parentId={null} nodes={nodes} />
                      : <PlaceholderRow key="__ph_root_end" depth={ph.depth} base={0} indent={INDENT_NESTED} />
                  );
                  return out;
                })()}
              </div>
            )}
          </TooltipProvider>

          <DragOverlay dropAnimation={null}>
            {activeId ? (
              <div style={{ width: overlayWidth ?? undefined }}>
                <DragItem id={activeId} nodes={nodes} flatMode={flatMode} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Markdown Drawer (portal to body to bypass page stacking context) */}
      {mounted && createPortal((
        <div className={cn("fixed inset-0 z-[80]", mdOpen ? "pointer-events-auto" : "pointer-events-none")}> 
          <div
            className={cn("absolute inset-0 bg-black/30 transition-opacity", mdOpen ? "opacity-100" : "opacity-0")}
            onClick={() => setMdOpen(false)}
          />
          <div
            className={cn(
              "absolute right-0 top-0 h-full w-[min(90vw,760px)] border-l bg-card shadow-xl transition-transform duration-200 ease-out flex flex-col",
              mdOpen ? "translate-x-0" : "translate-x-full",
            )}
            onClick={(e)=>e.stopPropagation()}
          >
          <div className="h-12 flex items-center justify-between px-4 border-b">
            <div className="text-sm font-medium">Markdown 预览</div>
            <div className="flex items-center">
            <button
              className="inline-flex h-8 px-2 items-center justify-center rounded-md bg-muted text-foreground hover:bg-muted/80 cursor-pointer"
              title="复制"
              aria-label="复制 Markdown"
              onClick={async()=>{
                try {
                  // clipboard API with fallback
                  try {
                    await navigator.clipboard.writeText(mdText);
                  } catch {
                    const ta = document.createElement('textarea');
                    ta.value = mdText; ta.style.position = 'fixed'; ta.style.left = '-9999px';
                    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                  }
                  setMdCopied(true);
                  showToast({ title: '已复制到剪贴板', variant: 'success' });
                  setTimeout(()=> setMdCopied(false), 1200);
                } catch {
                  showToast({ title: '复制失败', variant: 'error' });
                }
              }}
            >
              {mdCopied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
            </button>
            <button
              className="ml-2 inline-flex h-8 px-2 items-center justify-center rounded-md bg-foreground text-background hover:opacity-90 cursor-pointer"
              title="从 Markdown 导入（覆盖当前产品）"
              aria-label="导入"
              onClick={()=> setMdImportOpen(true)}
            >
              <ImportIcon className="size-4" />
            </button>
            <AlertDialog open={mdImportOpen} onOpenChange={setMdImportOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>导入 Markdown</AlertDialogTitle>
                  <AlertDialogDescription>将使用当前 Markdown 覆盖该产品的特性树，此操作不可撤销。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button variant="outline" size="sm" className="cursor-pointer">取消</Button>
                  </AlertDialogCancel>
                  <AlertDialogAction asChild>
                    <Button size="sm" className="cursor-pointer" onClick={async()=>{
                      try {
                        const parsed = parseMarkdownToNodes(mdText);
                        if (!parsed.length) { showToast({ title: '未解析到项目', variant: 'error' }); return; }
                        doReplaceAll(parsed);
                        showToast({ title: `已导入 ${parsed.length} 项`, variant: 'success' });
                      } catch (e) {
                        showToast({ title: '导入失败', description: e instanceof Error ? e.message : String(e), variant: 'error' });
                      }
                    }}>导入</Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            </div>
          </div>
          <div className="flex-1 p-4 overflow-hidden">
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme="vs-light"
              value={mdText}
              onChange={(v)=> setMdText(String(v ?? ''))}
              options={{
                readOnly: false,
                wordWrap: "on",
                lineNumbers: "off",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 14,
              }}
            />
          </div>
          </div>
        </div>
      ), document.body)}

      {/* Chat Dock removed from here; rendered in page layout (right side) */}
    </div>
  );
}

function PlaceholderRow({ depth, base = 0, indent = INDENT }: { depth: number; base?: number; indent?: number }) {
  // 单一插入线，缩进与目标 depth 对齐 + 轻微动效
  return (
    <div style={{ marginLeft: Math.max(0, depth * indent - base) }} className="py-0.5">
      <div className="h-0.5 w-full rounded-full bg-blue-500/80 transition-all duration-150 ease-out" />
    </div>
  );
}

function FlatPlaceholderRow({ depth, parentId, nodes }: { depth: number; parentId: string | null; nodes: FeatureNode[] }) {
  // Build connector-like placeholder in flat mode
  const ancestors = parentId ? getAncestorIds(nodes, parentId).slice().reverse().concat([parentId]) : [];
  const isLastOf = (nid: string) => {
    const nd = nodes.find(x => x.id === nid);
    if (!nd) return false;
    const sibs = nodes.filter(x => x.parentId === nd.parentId).sort((a,b)=>a.order-b.order);
    const idx = sibs.findIndex(s => s.id === nd.id);
    return idx === sibs.length - 1;
  };
  const style = buildFlatPlaceholderStyle({ ancestors, isLastOf, depth, indent: INDENT_FLAT });
  return <div className="py-1 min-h-[18px] text-muted-foreground/60" style={style} />;
}

// 添加拖拽区域指示器 - 更明显的视觉反馈
function DropIndicator({ region, show, flat }: { region: "before" | "inside" | "after"; show: boolean; flat?: boolean }) {
  // 只在 inside 时高亮卡片边框，before/after 由唯一插入线负责
  if (!show || region !== "inside") return null;
  if (flat) {
    return <div className="absolute inset-0 bg-blue-500/8 pointer-events-none rounded" />;
  }
  return <div className="absolute inset-0 ring-2 ring-blue-400/60 ring-inset rounded-md bg-blue-50/20 pointer-events-none" />;
}

// 删除 slot 方案：不再渲染大量中间 droppable，只保留行级 droppable

// removed Slot gutters per request

function IconButton({ children, title, onClick, onPointerDown }: { children: React.ReactNode; title?: string; onClick?: React.MouseEventHandler; onPointerDown?: React.PointerEventHandler }) {
  return (
    <button
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
      title={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Toolbar({ query, setQuery, onShowMarkdown, flatMode, setFlatMode }: { query: string; setQuery: (v: string) => void; onShowMarkdown: ()=>void; flatMode: boolean; setFlatMode: (v: boolean) => void }) {
  const addChild = useSetAtom(addChildAtom);
  const expandAll = useSetAtom(expandAllAtom);
  const collapseAll = useSetAtom(collapseAllAtom);
  const nodes = useAtomValue(nodesAtom);

  return (
    <div className="mb-3 flex items-center gap-3 justify-between">
      <div className="flex flex-col">
        <div className="text-sm font-medium flex items-center gap-2">
          <span>特性树</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder="搜索功能..."
          className="h-7 w-[200px]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer h-7 w-7 p-0"
          onClick={() => addChild({ parentId: null, title: "" })}
          title="新建分组"
        >
          <Plus className="size-4" />
        </Button>
        {(() => {
          const allCollapsed = nodes.every((n) => n.collapsed);
          return (
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer h-7 w-7 p-0"
              onClick={() => (allCollapsed ? expandAll() : collapseAll())}
              title={allCollapsed ? "展开全部" : "折叠全部"}
            >
              {allCollapsed ? <UnfoldVertical className="size-4" /> : <FoldVertical className="size-4" />}
            </Button>
          );
        })()}
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer h-7 w-7 p-0"
          onClick={onShowMarkdown}
          title="导出 Markdown"
        >
          <FileText className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("cursor-pointer h-7 w-7 p-0", flatMode && "bg-muted")}
          onClick={() => setFlatMode(!flatMode)}
          title={flatMode ? "嵌套模式" : "平铺模式"}
        >
          <ListTree className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function EmptyState() {
  const addChild = useSetAtom(addChildAtom);
  return (
    <div className="p-8 text-center text-muted-foreground">
      <div className="mb-4">空空如也</div>
      <Button variant="outline" className="cursor-pointer h-8 w-8 p-0" onClick={() => addChild({ parentId: null, title: "" })}>
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

function DragItem({ id, nodes, flatMode = false }: { id: string; nodes: FeatureNode[]; flatMode?: boolean }) {
  const n = nodes.find((x) => x.id === id);
  if (!n) return null;
  const cfg = statusConfig[n.status];
  if (!flatMode) {
    return (
      <div className="rounded-md border border-border bg-card shadow-xs" style={{ willChange: "transform" }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="select-none text-sm font-medium">{n.title}</div>
          <span className={cn("ml-1 inline-flex items-center rounded border px-1.5 py-0.5 text-xs", cfg.cls)}>
            {cfg.label}
          </span>
        </div>
        {n.description ? (
          <div className="px-3 pb-3 text-sm text-foreground/80" dangerouslySetInnerHTML={{ __html: n.description }} />
        ) : null}
      </div>
    );
  }
  // Flat mode overlay: render row-like ghost
  return (
    <div className="min-h-[36px] px-3 py-1 rounded-md bg-card/80 border border-dashed border-border text-muted-foreground/80" style={{ willChange: "transform" }}>
      <div className="flex items-center gap-2">
        <div className="select-none text-sm font-medium">{n.title}</div>
        <span className={cn("ml-1 inline-flex items-center rounded border px-1.5 py-0.5 text-xs", cfg.cls)}>
          {cfg.label}
        </span>
      </div>
    </div>
  );
}
type NodeBlockProps = { id: string; depth: number; insideContainer?: boolean; projection?: { depth: number; parentId: string | null; insertIndex: number } | null; flatMode?: boolean; animReady?: boolean; dragDisabled?: boolean; forceOpenSet?: Set<string> };

// 简单的关键字高亮：大小写不敏感，将匹配段包裹高亮背景
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function highlightText(text: string, query: string): React.ReactNode {
  const q = (query || "").trim();
  if (!q) return text;
  try {
    const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
    const parts = text.split(re);
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <span key={i} className="bg-violet-200 text-violet-800 font-medium px-0.5 rounded-sm">{part}</span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    );
  } catch {
    // 回退：正则构造异常时不处理
    return text;
  }
}

function NodeBlock({ id, depth, insideContainer, projection, flatMode = false, animReady = false, dragDisabled = false, forceOpenSet }: NodeBlockProps) {
  const nodes = useAtomValue(nodesAtom);
  const node = nodes.find((n) => n.id === id)!;
  const children = React.useMemo(() => getChildren(nodes, id), [nodes, id]);
  const hasChildren = children.length > 0;
  const isOpen = !node.collapsed || (forceOpenSet?.has(id) ?? false);
  const query = useAtomValue(searchQueryAtom);
  const breadcrumbSegs = React.useMemo(() => {
    if (depth <= 0) return [] as string[];
    const ids = getAncestorIds(nodes, id).reverse();
    const titles = ids.map(aid => nodes.find(n => n.id === aid)?.title).filter(Boolean) as string[];
    return titles;
  }, [nodes, id, depth]);

  // Row
  const [editingId, setEditingId] = useAtom(editingIdAtom);
  const [editingDetailId, setEditingDetailId] = useAtom(editingDetailIdAtom);
  const [, setSelectedNodeId] = useAtom(selectedNodeIdAtom);
  const activeId = useAtomValue(activeIdAtom);
  const overId = useAtomValue(overIdAtom);
  const overRegionVal = useAtomValue(overRegionAtom);
  const rename = useSetAtom(renameNodeAtom);
  const updateStatus = useSetAtom(updateNodeStatusAtom);
  const updateStatusCascade = useSetAtom(updateNodeStatusCascadeAtom);
  const updateDescription = useSetAtom(updateNodeDescriptionAtom);
  const toggle = useSetAtom(toggleCollapseAtom);
  const addChild = useSetAtom(addChildAtom);
  const addBelow = useSetAtom(addSiblingBelowAtom);
  const del = useSetAtom(deleteNodeAtom);

  // line-only: combine droppable + draggable on the card element
  const { setNodeRef: setDropRef } = useDroppable({ id, data: { depth }, disabled: dragDisabled });
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id, data: { depth }, disabled: dragDisabled });
  const [childrenParent] = useAutoAnimate({ duration: 180, easing: "ease-out" });
  const [titleDraft, setTitleDraft] = React.useState("");
  const [descDraft, setDescDraft] = React.useState("");
  // Prevent unintended collapse after status dropdown selection (click-through)
  const suppressToggleRef = React.useRef<number>(0);
  const suppressToggle = () => { suppressToggleRef.current = Date.now(); };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") setEditingId(null);
  };

  const handleNodeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // keep selection logic minimal; description is always visible now
    if (editingId !== id && editingDetailId !== id) setSelectedNodeId(id);
    // Guard against click-through right after status selection
    if (Date.now() - suppressToggleRef.current < 400) return;
  };

  // sync drafts when进入/退出编辑
  React.useEffect(() => {
    if (editingId === id) {
      setTitleDraft(node.title);
      setDescDraft(node.description);
    }
  }, [editingId, id, node.title, node.description]);

  // In flat mode, keep wrapper aligned to root (no margin-left); we add indent via row padding
  const visualOffset = flatMode ? 0 : (insideContainer ? 0 : depth * INDENT);
  // const isSelected = selectedNodeId === id; // selection styling not used currently
  const isEditing = editingId === id; // 我们用同一个编辑态控制名称与描述

  // Drag projection and drop indicator
  // use above activeId/overId to avoid duplicate subscriptions
  // Auto expand when hovering for a bit during drag
  React.useEffect(() => {
    if (overId === id && node.collapsed && overRegionVal === "inside") {
      const t = setTimeout(() => { toggle(id); }, flatMode ? 350 : 450);
      return () => clearTimeout(t);
    }
  }, [overId, id, node.collapsed, toggle, overRegionVal, flatMode]);

  const contextMenuItems = [
    {
      label: "添加子项",
      icon: <Plus className="size-4" />,
      onClick: () => addChild({ parentId: id, title: "" }),
    },
    {
      label: "重命名",
      icon: <Pencil className="size-4" />,
      onClick: () => setEditingId(id),
    },
    {
      label: "添加同级",
      icon: <PlusCircle className="size-4" />,
      onClick: () => addBelow({ id, title: "" }),
    },
    {
      label: "删除（含子项）",
      icon: <Trash className="size-4" />,
      onClick: () => del(id),
    },
  ];

  // deprecated flags

  // Build flat-mode connector background (virtual tree lines)
  const rowStyle: React.CSSProperties | undefined = React.useMemo(() => {
    if (!flatMode) return undefined;
    const indent = INDENT_FLAT;
    const ancestors = getAncestorIds(nodes, id).slice().reverse();
    const isLastOf = (nid: string) => {
      const nd = nodes.find(x => x.id === nid);
      if (!nd) return false;
      const sibs = nodes.filter(x => x.parentId === nd.parentId).sort((a,b)=>a.order-b.order);
      const idx = sibs.findIndex(s => s.id === nd.id);
      return idx === sibs.length - 1;
    };
    return buildFlatConnectorStyle({ ancestors, isLastOf, depth, indent });
  }, [flatMode, nodes, id, depth]);

  return (
    <div className={cn(flatMode ? "space-y-0" : "space-y-2")} style={{ marginLeft: visualOffset }}>
      {/* using placeholder rows only */}
      <ContextMenu items={contextMenuItems}>
        <div
          data-node-id={id}
          className={cn(
            "relative",
            isDragging && "opacity-0",
            !flatMode && "rounded-md border border-border bg-card shadow-xs",
          )}
        > 
          {/* 拖拽区域指示器 */}
          <DropIndicator 
            region={overRegionVal ?? "inside"} 
            show={overId === id && overRegionVal === "inside" && activeId !== null && activeId !== id}
            flat={flatMode}
          />
          
          <div
            ref={(el) => { setDropRef(el); setDragRef(el); }}
            className={cn(
              "group flex items-center gap-2 relative transition-colors",
              flatMode ? "min-h-[36px] text-muted-foreground/70 hover:bg-muted/15 px-3 py-1" : "px-3 py-2 rounded-md",
              hasChildren ? "cursor-pointer" : "cursor-default",
            )}
            style={rowStyle}
            onClick={(e) => {
              handleNodeClick(e);
              if (Date.now() - suppressToggleRef.current < 400) return;
              if (hasChildren) toggle(id);
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && hasChildren) {
                e.preventDefault();
                toggle(id);
              }
            }}
            {...attributes}
            {...listeners}
          >

        {isEditing ? (
            <div className="flex-1 flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-muted-foreground">名称</div>
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitleDraft(e.target.value)}
                onKeyDown={onKeyDown}
                className="h-8 w-[480px]"
              />
            </div>
            <div className="ml-auto" />
          </div>
        ) : (
          <div className="w-full flex items-start gap-2">
            <div className="flex-1 min-w-0">
              {!flatMode && depth > 0 && breadcrumbSegs.length > 0 ? (
                <div className="px-1 pb-0.5 text-[11px] leading-4 text-muted-foreground/90">
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                    {breadcrumbSegs.map((name, i) => (
                      <React.Fragment key={`${id}_crumb_${i}`}>
                        <span className="truncate max-w-[180px]">{name}</span>
                        {i < breadcrumbSegs.length - 1 && <span className="text-muted-foreground/40">/</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded px-1 py-1 transition-colors overflow-hidden",
                    hasChildren ? "" : "opacity-90",
                  )}
                >
                  {hasChildren ? (
                    isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />
                  ) : null}
                  <div className="select-none text-sm font-medium truncate">{highlightText(node.title, query)}</div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "inline-flex items-center h-5 rounded border px-1 py-0 text-[11px] leading-5 cursor-pointer hover:opacity-90",
                        statusConfig[node.status].cls,
                      )}
                    >
                      {statusConfig[node.status].label}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {Object.entries(statusConfig).map(([key, cfg]) => (
                      <DropdownMenuItem key={key} onClick={() => {
                        suppressToggle();
                        // 父节点修改时，级联影响所有子级；子节点只影响自身
                        if (hasChildren) updateStatusCascade({ id, status: key as FeatureStatus });
                        else updateStatus({ id, status: key as FeatureStatus });
                      }}>
                        <span className={cn("mr-2 inline-block size-2 rounded-full border", cfg.cls)} />
                        {cfg.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              
            </div>
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  title="编辑"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(id);
                    setEditingDetailId(id);
                  }}
                >
                  <Pencil className="size-4" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>编辑</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  title="添加子项"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    addChild({ parentId: id, title: "" });
                  }}
                >
                  <Plus className="size-4" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>添加子项</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  title="删除"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    del(id);
                  }}
                >
                  <Trash className="size-4" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>删除（含子项）</TooltipContent>
            </Tooltip>
          </div>
        </div>
        )}
        </div>

        {/* Description inside the same card (hidden in flat mode) */}
        {isEditing ? (
          <div className="px-3 pb-3">
            <div className="mb-2 text-xs text-muted-foreground">描述</div>
            <TiptapEditor value={descDraft} onChange={setDescDraft} className="prose-xs text-[14px] leading-5" />
          </div>
        ) : (
          !flatMode && node.description && (
            <div className="px-3 pb-3 text-sm text-foreground/80" dangerouslySetInnerHTML={{ __html: node.description }} />
          )
        )}

        {isEditing && (
          <div className="absolute top-2 right-2 z-20">
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                const t = titleDraft.trim();
                if (!t) { del(id); return; } // 标题为空则删除此项
                if (t !== node.title) rename({ id, title: t });
                if (descDraft !== node.description) updateDescription({ id, description: descDraft });
                setEditingId(null);
                setEditingDetailId(null);
              }}
            >
              完成
            </Button>
          </div>
        )}

        {/* inside is represented via horizontal indent on before/after lines; no separate inside line */}
        {hasChildren && isOpen ? (
          <div
            className={cn(
              flatMode ? "space-y-0" : "space-y-2",
              !flatMode && "pl-3 pr-3 pt-2 pb-2 rounded-md",
              !flatMode && (depth % 2 === 0 ? "bg-muted/30" : "bg-transparent"),
            )}
            ref={animReady && !activeId ? childrenParent : undefined}
          >
            {(() => {
              const out: React.ReactNode[] = [];
              const ph = projection && projection.parentId === id ? projection : null;
              
              children.forEach((c, i) => {
                if (ph && ph.insertIndex === i) out.push(
                  flatMode
                    ? <FlatPlaceholderRow key={`__ph_${id}_${i}`} depth={ph.depth} parentId={id} nodes={nodes} />
                    : <PlaceholderRow key={`__ph_${id}_${i}`} depth={ph.depth} base={visualOffset} indent={INDENT_NESTED} />
                );
                out.push(
                  <NodeBlock
                    key={c.id}
                    id={c.id}
                    depth={depth + 1}
                    insideContainer
                    projection={projection}
                    flatMode={flatMode}
                    animReady={animReady}
                    dragDisabled={dragDisabled}
                    forceOpenSet={forceOpenSet}
                  />,
                );
              });

              if (ph && ph.insertIndex >= children.length)
                out.push(
                  flatMode
                    ? <FlatPlaceholderRow key={`__ph_${id}_end`} depth={ph.depth} parentId={id} nodes={nodes} />
                    : <PlaceholderRow key={`__ph_${id}_end`} depth={ph.depth} base={visualOffset} indent={INDENT_NESTED} />
                );
              return out;
            })()}
          </div>
        ) : null}
        </div>
      </ContextMenu>
      {/* using placeholder rows only */}
    </div>
  );
}
