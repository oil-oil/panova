"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { cn, genId } from "@/lib/utils";
import { DEFAULT_MODEL } from "@/lib/ai/config";
import { systemForJson } from "@/lib/ai/prompt";
import { chatStream, type ChatMessage } from "@/lib/ai/client";
import { markdownToHtml, htmlToMarkdownLite as htmlToMarkdown, stripHtml } from "@/lib/markdown";
import { tryParseAiEnvelope, sanitizeAssistantText } from "@/lib/ai/utils";
import { ZEnvelope } from "@/lib/ai/schema";
import { MessageSquareText, RotateCcw, Loader2, ArrowUp, Pause, AppWindowMac, FileText as DocIcon, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import DiffDialog from "@/components/ui/diff-dialog";
import { applyDocSearchReplacePatch } from "@/lib/patch/mkpatch";
import ActionProposals, { type OpState as UIOpState } from "@/components/ai/ActionProposals";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { TiptapEditor } from "@/components/ui/tiptap-editor";
import { Extension } from "@tiptap/core";
import { DocChip, DOC_CHIP_CLASS } from "@/components/ui/doc-chip";
import { ProdChip, PROD_CHIP_CLASS } from "@/components/ui/prod-chip";
import { DocMention } from "@/components/ui/tiptap-ext-doc-mention";
import { ProdMention } from "@/components/ui/tiptap-ext-prod-mention";
import { computeMentionRange, insertDocMentionChip, insertProdMentionChip } from "@/components/ui/tiptap-mention-utils";
import { useToast } from "@/components/ui/toast";
import { nodesAtom, addExactNodeAtom, renameNodeAtom, updateNodeDescriptionAtom, updateNodeStatusAtom, moveNodeAtom, deleteNodeAtom, productsAtom, loadProductsAtom } from "@/lib/feature-tree-atoms";
import { TOOL_LABELS } from "@/lib/ai/tools-catalog";
import type { Envelope, FeatureAction as AIAction, DocAction, UnifiedAction, NodeRef, DocRef } from "@/types/ai";
import { FEATURE_ACTIONS, DOC_ACTIONS, PRODUCT_ACTIONS } from "@/types/ai";
import { FEATURE_STATUS_META } from "@/lib/ai/actions";
import { docsAtom, loadDocsAtom, createDocExactAtom, updateDocTitleAtom, updateDocContentAtom, deleteDocAtom } from "@/lib/doc-atoms";
import { createProductExactAtom, deleteProductAtom, selectProductAtom, selectedProductIdAtom } from "@/lib/feature-tree-atoms";

// Chat message model. `images` holds inline images sent with the user message (data URLs preferred).
// Tool-call logs (hoisted so Msg can reference it)
type ToolLog = { id: string; callId?: string | null; name: string; startedAt: number; endedAt?: number; status: 'running'|'done'|'error'; input?: unknown; output?: unknown; error?: unknown };
// Chat message model. `images` holds inline images sent with the user message (data URLs preferred).
type Msg = { id: string; role: "user" | "assistant"; content: string; ts: number; ops?: UnifiedAction[]; opStates?: Record<number, UIOpState>; tools?: ToolLog[]; images?: string[] };

function useLocalState<T>(key: string, initial: T) {
  const [state, setState] = React.useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  React.useEffect(() => { try { window.localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState] as const;
}

// moved to src/lib/ai/context.ts

export default function ChatDock({ className, onClose }: { className?: string; onClose?: ()=>void }) {
  const nodes = useAtomValue(nodesAtom);
  const doExactAdd = useSetAtom(addExactNodeAtom);
  const doRename = useSetAtom(renameNodeAtom);
  const doDesc = useSetAtom(updateNodeDescriptionAtom);
  const doStatus = useSetAtom(updateNodeStatusAtom);
  const doMove = useSetAtom(moveNodeAtom);
  const doDel = useSetAtom(deleteNodeAtom);
  const setNodes = useSetAtom(nodesAtom);
  const { show: showToast } = useToast();
  const createProductExact = useSetAtom(createProductExactAtom);
  const deleteProduct = useSetAtom(deleteProductAtom);
  const selectProduct = useSetAtom(selectProductAtom);
  const currentProductId = useAtomValue(selectedProductIdAtom);

  const [msgs, setMsgs] = useLocalState<Msg[]>("ai_chat_msgs", []);
  const [inputHtml, setInputHtml] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [stage, setStage] = React.useState<string | null>(null);
  type Step = { id: string; name: string; status: 'running'|'done'|'error'; startedAt: number; endedAt?: number };
  const [steps, setSteps] = React.useState<Step[]>([]);

  // Tool-call logs for the current turn; serialized into a message for persistence
  const [toolLogs, setToolLogs] = React.useState<ToolLog[]>([]);
  const toolLogsRef = React.useRef<ToolLog[]>([]);
  React.useEffect(() => { toolLogsRef.current = toolLogs; }, [toolLogs]);
  const [openTool, setOpenTool] = React.useState<Record<string, boolean>>({});
  // 二次确认（文档写入）
  type PendingDocConfirm = {
    msgId: string;
    index: number;
    op: DocAction;
    docId: string;
    docTitle: string;
    beforeMd: string;
    afterMd: string;
  } | null;
  const [docConfirm, setDocConfirm] = React.useState<PendingDocConfirm>(null);
  // 局部补丁确认
  type PendingPatchConfirm = {
    msgId: string;
    index: number;
    op: DocAction; // doc_patch
    docId: string;
    docTitle: string;
    beforeMd: string;
    patch: string;
    format: 'search_replace'|'udiff';
    afterMd: string;
  } | null;
  const [patchConfirm, setPatchConfirm] = React.useState<PendingPatchConfirm>(null);

  // Map tool internal names to Chinese labels for UI (centralized in tools.ts)
  const toolLabel = React.useCallback((name: string | undefined | null) => {
    const key = String(name || '').trim() as keyof typeof TOOL_LABELS;
    return (TOOL_LABELS as Record<string, string>)[key] || key || '工具';
  }, []);
  const [error, setError] = React.useState<string | null>(null);

  // 操作卡片状态 & 应用/忽略/撤回
  function ensureOpStates(len: number): Record<number, UIOpState> { const st: Record<number, UIOpState> = {}; for (let i=0;i<len;i++) st[i] = { status: 'pending' }; return st; }
  function setOpState(msgId: string, idx: number, patch: Partial<UIOpState> | UIOpState) {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const cur = (m.opStates && m.opStates[idx]) || { status: 'pending' } as UIOpState;
      const next: UIOpState = ('status' in patch) ? (patch as UIOpState) : ({ ...cur, ...(patch as Partial<UIOpState>) } as UIOpState);
      return { ...m, opStates: { ...(m.opStates||{}), [idx]: next } } as Msg;
    }));
  }

  async function applyProposedUnified(msgId: string, index: number, op: UnifiedAction) {
    try {
      const actName = String((op as { action?: string }).action || '');
      const isDoc = actName.startsWith('doc_');
      const isProd = actName.startsWith('product_');
      // 先标记 applying，若需要二次确认会立即回退到 pending
      setOpState(msgId, index, { status: 'applying', error: undefined });
      type OpMeta = { [k: string]: unknown } & { targetId?: string; createdIds?: string[] };
      const meta: OpMeta = {};
      if (isProd) {
        if (actName === PRODUCT_ACTIONS.PRODUCT_CREATE) {
          const desiredId = (op as { id?: string }).id;
          const name = (op as { name?: string }).name;
          const id = await createProductExact({ id: desiredId, name, select: true });
          meta.id = id;
        } else if (actName === PRODUCT_ACTIONS.PRODUCT_SELECT) {
          meta.prevSelected = currentProductId;
          const id = (op as { id?: string }).id as string;
          if (id) await selectProduct(id);
        }
        setOpState(msgId, index, { status: 'applied', error: undefined });
      } else if (!isDoc) {
        const act = op as AIAction;
        if (act.action === FEATURE_ACTIONS.ADD) {
          // 若批量新增，记录所有创建 id，便于撤回
          // applyAction 内已写入 __createdIds（在批量插入分支）
          const ids = (act as unknown as { __createdIds?: string[] }).__createdIds;
          if (Array.isArray(ids)) meta.createdIds = ids;
        } else if (act.action === FEATURE_ACTIONS.RENAME) {
          const tid = resolveRef(act.target); if (tid) { const n = nodes.find(x=>x.id===tid); meta.prevTitle = n?.title || ''; meta.targetId = tid; }
        } else if (act.action === FEATURE_ACTIONS.SET_DESCRIPTION) {
          const tid = resolveRef(act.target); if (tid) { const n = nodes.find(x=>x.id===tid); meta.prevDesc = n?.description || ''; meta.targetId = tid; }
        } else if (act.action === FEATURE_ACTIONS.SET_STATUS) {
          const tid = resolveRef(act.target); if (tid) { const n = nodes.find(x=>x.id===tid); meta.prevStatus = n?.status || 'pending'; meta.targetId = tid; }
        } else if (act.action === FEATURE_ACTIONS.MOVE) {
          const tid = resolveRef(act.target); if (tid) { const n = nodes.find(x=>x.id===tid); meta.prevParentId = n?.parentId ?? null; const siblings = nodes.filter(x=>x.parentId === (n?.parentId ?? null)).sort((a,b)=>a.order-b.order); meta.prevIndex = Math.max(0, siblings.findIndex(x=>x.id===tid)); meta.targetId = tid; }
        } else if (act.action === FEATURE_ACTIONS.DELETE) {
          meta.unsupportedUndo = true; const tid = resolveRef(act.target); if (tid) meta.targetId = tid;
        }
        const r = applyAction(act);
        if (!r.ok) { setOpState(msgId, index, { status: 'failed', error: r.reason || 'unknown' }); return; }
        if (meta.targetId === undefined) meta.targetId = r.targetId;
        // save meta
        setMsgs(prev => prev.map(m => m.id===msgId ? ({ ...m, opStates: { ...(m.opStates||{}), [index]: { ...(m.opStates?.[index]||{status:'applied'}), ...meta, status: 'applied', error: undefined } } }) : m));
      } else {
        const d = op as DocAction;
        const resolveDocId = () => ('target' in d ? resolveDocRef(d.target) : (d.id || null));
        if (d.action === DOC_ACTIONS.DOC_RENAME) { const id = resolveDocId(); const item = (docs||[]).find(x=>x.id===id); meta.prevTitle = item?.title || ''; meta.id = id; }
        else if (d.action === DOC_ACTIONS.DOC_SET_CONTENT) {
          const id = resolveDocId(); const item = (docs||[]).find(x=>x.id===id);
          meta.prevHtml = item?.content || '';
          meta.id = id;
          // 开启二次确认：以 Markdown 形式展示前/后内容
          try {
            const beforeMd = htmlToMarkdown(item?.content || '');
            const afterMd = d.content_md || '';
            const title = item?.title || '';
            if (id) setDocConfirm({ msgId, index, op: d, docId: id, docTitle: title, beforeMd, afterMd });
            // 回退到 pending，等待用户确认
            setOpState(msgId, index, { status: 'pending', error: undefined });
            return;
          } catch {
            // 如果转换失败，继续直接应用
          }
        }
        else if ((d as any).action === DOC_ACTIONS.DOC_PATCH) {
          const id = resolveDocId(); const item = (docs||[]).find(x=>x.id===id);
          meta.prevHtml = item?.content || '';
          meta.id = id;
          const title = item?.title || '';
          const beforeMd = htmlToMarkdown(item?.content || '');
          const fmt = ((d as any).format === 'udiff') ? 'udiff' : 'search_replace';
          try {
            const patch = String((d as any).patch || '');
            const afterMd = fmt === 'search_replace' ? applyDocSearchReplacePatch(beforeMd, patch) : beforeMd;
            if (id) setPatchConfirm({ msgId, index, op: d, docId: id, docTitle: title, beforeMd, patch, format: fmt, afterMd });
            setOpState(msgId, index, { status: 'pending', error: undefined });
            return;
          } catch (e) {
            setOpState(msgId, index, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
            return;
          }
        }
        else if (d.action === DOC_ACTIONS.DOC_DELETE) { const id = resolveDocId(); const item = (docs||[]).find(x=>x.id===id); meta.restore = { id: id || '', title: item?.title || '', content_html: item?.content || '' }; }
        const r = await applyDocAction(d);
        if (!r.ok) { setOpState(msgId, index, { status: 'failed', error: r.reason || 'unknown' }); return; }
        if (meta.id === undefined) meta.id = r.targetId;
        setMsgs(prev => prev.map(m => m.id===msgId ? ({ ...m, opStates: { ...(m.opStates||{}), [index]: { ...(m.opStates?.[index]||{status:'applied'}), ...meta, status: 'applied', error: undefined } } }) : m));
        try { loadDocs(); } catch {}
      }
    } catch (e) {
      setOpState(msgId, index, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  function ignoreProposed(msgId: string, index: number, _op: UnifiedAction) {
    setOpState(msgId, index, { status: 'ignored', error: undefined });
  }

  async function applyAllForMessage(msgId: string) {
    const m = msgs.find((x) => x.id === msgId);
    if (!m || !Array.isArray(m.ops) || m.ops.length === 0) return;
    for (let i = 0; i < m.ops.length; i++) {
      const st = (m.opStates && m.opStates[i]) || { status: 'pending' } as UIOpState;
      if (st.status === 'pending' || st.status === 'failed') {
        try { await applyProposedUnified(msgId, i, (m.ops as UnifiedAction[])[i]); } catch {}
      }
    }
  }

  async function undoProposedUnified(msgId: string, index: number, op: UnifiedAction) {
    try {
      const actName = String((op as { action?: string }).action || '');
      const isDoc = actName.startsWith('doc_');
      const isProd = actName.startsWith('product_');
      setOpState(msgId, index, { status: 'undoing' });
      type OpMeta = { id?: string; prevSelected?: string; prevTitle?: string; prevDesc?: string; prevStatus?: string; prevParentId?: string|null; prevIndex?: number; targetId?: string; createdIds?: string[]; restore?: { id: string; title: string; content_html: string } };
      const st: OpMeta = (msgs.find(m=>m.id===msgId)?.opStates || {})[index] as OpMeta || {};
      if (isProd) {
        if (actName === PRODUCT_ACTIONS.PRODUCT_CREATE) {
          const id = st?.id || (op as { id?: string }).id; if (id) await deleteProduct(id);
        } else if (actName === PRODUCT_ACTIONS.PRODUCT_SELECT) {
          const prev = st?.prevSelected; if (prev) await selectProduct(prev);
        }
        setOpState(msgId, index, { status: 'pending', error: undefined });
      } else if (!isDoc) {
        const a = op as AIAction; const tid = st?.targetId || resolveRef((a as AIAction).target);
        if (a.action === FEATURE_ACTIONS.ADD) {
          const ids: string[] = Array.isArray(st.createdIds) ? st.createdIds! : (tid ? [tid] : []);
          // 逆序删除，避免顺序影响
          for (let i = ids.length - 1; i >= 0; i--) { const id = ids[i]; if (id) doDel(id); }
        }
        else if (a.action === FEATURE_ACTIONS.RENAME) { if (tid) doRename({ id: tid, title: st?.prevTitle || '' }); }
        else if (a.action === FEATURE_ACTIONS.SET_DESCRIPTION) { if (tid) doDesc({ id: tid, description: st?.prevDesc || '' }); }
        else if (a.action === FEATURE_ACTIONS.SET_STATUS) { if (tid) doStatus({ id: tid, status: st?.prevStatus || 'pending' }); }
        else if (a.action === FEATURE_ACTIONS.MOVE) { if (tid) doMove({ id: tid, newParentId: st?.prevParentId ?? null, newIndex: typeof st?.prevIndex === 'number' ? st?.prevIndex : 0 }); }
        else if (a.action === FEATURE_ACTIONS.DELETE) { setOpState(msgId, index, { status: 'failed', error: '该操作暂不支持撤回' }); return; }
        setOpState(msgId, index, { status: 'pending', error: undefined });
      } else {
        const d = op as DocAction;
        if (d.action === DOC_ACTIONS.DOC_CREATE) { const id = st?.id || d.id; if (id) await removeDoc(id); }
        else if (d.action === DOC_ACTIONS.DOC_RENAME) { const id = st?.id || resolveDocRef(d.target); await setDocTitle({ id: id!, title: st?.prevTitle || '' }); }
        else if (d.action === DOC_ACTIONS.DOC_SET_CONTENT) { const id = st?.id || resolveDocRef(d.target); await setDocContent({ id: id!, content: (st as any)?.prevHtml || '' }); }
        else if (d.action === DOC_ACTIONS.DOC_DELETE) { const r = st?.restore; if (r && r.id) await createExact({ id: r.id, title: r.title, content_html: r.content_html, select: false }); }
        try { loadDocs(); } catch {}
        setOpState(msgId, index, { status: 'pending', error: undefined });
      }
    } catch (e) { setOpState(msgId, index, { status: 'failed', error: e instanceof Error ? e.message : String(e) }); }
  }

  // 直接在操作卡片上“应用/忽略”，不再二次确认（文档写入会弹二次确认）

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [autoStick, setAutoStick] = React.useState(true);
  const abortRef = React.useRef<AbortController | null>(null);

  // --- 文档库用于 @ 引用 ---
  const [docs] = useAtom(docsAtom);
  const products = useAtomValue(productsAtom);
  const loadProducts = useSetAtom(loadProductsAtom);
  const loadDocs = useSetAtom(loadDocsAtom);
  const createExact = useSetAtom(createDocExactAtom);
  const setDocTitle = useSetAtom(updateDocTitleAtom);
  const setDocContent = useSetAtom(updateDocContentAtom);
  const removeDoc = useSetAtom(deleteDocAtom);
  React.useEffect(() => { try { loadProducts(); } catch {} }, [loadProducts]);
  React.useEffect(() => { try { loadDocs(); } catch {} }, [loadDocs]);

  // 暂存 tiptap 实例，用于计算光标与提取 @ 查询
  type TiptapEditorLike = { chain: () => { focus: () => { run: () => void } } };
  const inputEditorRef = React.useRef<TiptapEditorLike | null>(null);
  const [mentionOpen, setMentionOpen] = React.useState(false);
  const [mentionQuery, setMentionQuery] = React.useState("");
  const [mentionIdx, setMentionIdx] = React.useState(0);
  const mentionRangeRef = React.useRef<{ from: number; to: number } | null>(null);
  type MentionItem = { id: string; label: string; kind: 'prod'|'doc' };
  const mentionItemsRef = React.useRef<MentionItem[]>([]);
  const mentionIdxRef = React.useRef(0);
  // note: mentionOpenRef was unused; removed to simplify state bookkeeping
  // mentionItems and mentionIdx refs are updated after their declarations


  const mentionItems = React.useMemo(() => {
    const prod = (products || []).map((p)=>({ id: p.id, label: p.name || '未命名', kind: 'prod' as const }));
    const doc = (docs || []).map(d => ({ id: d.id, label: d.title || '未命名', kind: 'doc' as const }));
    const q = (mentionQuery || '').trim().toLowerCase();
    let filteredProd = prod, filteredDoc = doc;
    if (q) {
      try { filteredProd = prod.filter(it => it.label.toLowerCase().includes(q)); } catch { filteredProd = prod; }
      try { filteredDoc = doc.filter(it => it.label.toLowerCase().includes(q)); } catch { filteredDoc = doc; }
    }
    return [...filteredProd, ...filteredDoc].slice(0, 30);
  }, [docs, products, mentionQuery]);
  React.useEffect(() => { mentionItemsRef.current = mentionItems; }, [mentionItems]);
  React.useEffect(() => { mentionIdxRef.current = mentionIdx; }, [mentionIdx]);

  const mentionKeyExt = React.useMemo(() => Extension.create({
    name: 'docMentionKeymap',
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          const cur = computeMentionFromEditor();
          if (!cur.has) return false;
          const items = mentionItemsRef.current || [];
          const idx = Math.max(0, Math.min(mentionIdxRef.current, Math.max(0, items.length - 1)));
          const it = items[idx] || items[0];
          if (it) { applyMention(it); return true; }
          return false;
        },
        ArrowDown: () => {
          const cur = computeMentionFromEditor();
          if (!cur.has) return false;
          setMentionIdx((i)=> Math.min(i + 1, Math.max(0, (mentionItemsRef.current?.length||1) - 1)));
          return true;
        },
        ArrowUp: () => {
          const cur = computeMentionFromEditor();
          if (!cur.has) return false;
          setMentionIdx((i)=> Math.max(0, i - 1));
          return true;
        },
        Escape: () => {
          const cur = computeMentionFromEditor();
          if (!cur.has) return false;
          closeMention();
          return true;
        },
      };
    },
  }), []);

  function computeMentionFromEditor(): { has: boolean; query: string; from: number; to: number } {
    const ed = inputEditorRef.current; return computeMentionRange(ed);
  }

  function openMentionIfNeeded() {
    const r = computeMentionFromEditor();
    if (!r.has) { setMentionOpen(false); setMentionQuery(''); mentionRangeRef.current = null; return; }
    setMentionOpen(true); setMentionQuery(r.query || ''); mentionRangeRef.current = { from: r.from, to: r.to }; setMentionIdx(0);
  }

  function closeMention() { setMentionOpen(false); setMentionQuery(''); mentionRangeRef.current = null; setMentionIdx(0); }

  function applyMention(item: MentionItem) {
    // Replace the whole "@query" with a docMention chip via custom command, then add a space.
    const ed = inputEditorRef.current; if (!ed) return;
    // Always recompute range right before applying to avoid using a stale mentionRangeRef
    const r = computeMentionFromEditor();
    try { item.kind==='prod' ? insertProdMentionChip(ed as unknown as any, item, { from: r.from, to: r.to }) : insertDocMentionChip(ed as unknown as any, item, { from: r.from, to: r.to }); } catch {}
    try { (ed as TiptapEditorLike).chain().focus().run(); } catch {}
    closeMention();
  }

  // --- Pasted image handling ---
  type PastedImage = { id: string; file: File; url: string; dataUrl?: string };
  const [images, setImages] = React.useState<PastedImage[]>([]);
  React.useEffect(() => () => { images.forEach((im) => { try { URL.revokeObjectURL(im.url); } catch {} }); }, []);
  async function handlePaste(e: React.ClipboardEvent) {
    try {
      const files = Array.from(e.clipboardData?.files || []).filter((f) => /^image\/(png|jpe?g|webp|gif)$/i.test(f.type));
      if (!files.length) return;
      // Don't block text paste; just collect images
      const items: PastedImage[] = files.map((file) => ({ id: genId('img'), file, url: URL.createObjectURL(file) }));
      setImages((prev) => [...prev, ...items]);
      // Convert to dataUrl for vision API
      for (const it of items) {
        const dataUrl = await new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.readAsDataURL(it.file); });
        setImages((prev) => prev.map((x) => (x.id === it.id ? { ...x, dataUrl } : x)));
      }
    } catch {}
  }
  function removeImage(id: string) { setImages((prev) => { const im = prev.find(x=>x.id===id); try { if (im) URL.revokeObjectURL(im.url); } catch {}; return prev.filter((x)=>x.id!==id); }); }

  React.useEffect(() => {
    const t = setTimeout(() => {
      if (autoStick && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight + 999;
    }, 30);
    return () => clearTimeout(t);
  }, [msgs.length, loading, autoStick]);

  const onScroll = React.useCallback(() => {
    const el = listRef.current; if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
    setAutoStick(nearBottom);
  }, []);
  React.useEffect(() => {
    const el = listRef.current; if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  function reset() { setMsgs([]); setError(null); setSteps([]); setToolLogs([]); setOpenTool({}); }


  async function sendOrPause() {
    if (loading) { try { abortRef.current?.abort(); } catch {} return; }
    let text = htmlToMarkdown(inputHtml).trim();
    if (!text && images.length === 0) return;
    setInputHtml(""); setError(null);

    // Snapshot current images as stable data URLs for rendering inside the outgoing bubble
    const snapshotImageDataUrls: string[] = [];
    if (images.length > 0) {
      for (const im of images) {
        if (im.dataUrl && im.dataUrl.startsWith('data:')) {
          snapshotImageDataUrls.push(im.dataUrl);
        } else {
          // Ensure we have a data URL before clearing the composer state
          try {
            const dataUrl: string = await new Promise((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result || ''));
              r.readAsDataURL(im.file);
            });
            snapshotImageDataUrls.push(dataUrl);
          } catch {
            // Fallback to object URL if conversion fails
            snapshotImageDataUrls.push(im.url);
          }
        }
      }
    }

    const user: Msg = { id: `m_${Date.now()}_u`, role: "user", content: text, ts: Date.now(), images: snapshotImageDataUrls.length ? snapshotImageDataUrls : undefined };
    setMsgs(prev => [...prev, user]);
    // Clear the composer image preview immediately after sending
    if (images.length > 0) setImages([]);
    // 发送后强制滚动到底部，确保看到刚刚发送的消息（不依赖 autoStick）
    try {
      setTimeout(() => {
        const el = listRef.current; if (!el) return;
        // 使用较大的偏移量避免像素误差
        el.scrollTop = el.scrollHeight + 999;
      }, 30);
    } catch {}

    // Local fast-path: if user directly pasted JSON envelope, parse it and render inline confirmation
    const localEnv = tryParseAiEnvelope(text);
    if (localEnv) {
      // 同时支持常规问答与操作提议：若有 answer_md 先展示为普通助手消息，若有 actions 再追加操作卡片
      setMsgs(prev => {
        const out = [...prev];
        if (localEnv.answer_md && localEnv.answer_md.trim()) {
          out.push({ id: `ans_${Date.now()}`, role: 'assistant', content: localEnv.answer_md, ts: Date.now() });
        }
        if (localEnv.actions && localEnv.actions.length) {
          out.push({ id: `ops_${Date.now()}`, role: 'assistant', content: '', ts: Date.now(), ops: localEnv.actions, opStates: ((): any=>{ const o: any = {}; for (let i=0;i<localEnv.actions!.length;i++) o[i]={status:'pending'}; return o;})() });
        }
        return out;
      });
      return; // do not call model when user already provided JSON
    }

    setLoading(true);
    setStage("正在分析请求…");
    setSteps([]);
    try {
      const ac = new AbortController(); abortRef.current = ac;
      // Optional: if images exist, call vision first and append its result
      let textWithVision = text;
      const visionImages = (user.images || []).map((url) => ({ url }));
      if (visionImages.length > 0) {
        setStage("正在分析图片…");
        try {
          const resp = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            model: 'qwen/qwen3-vl-235b-a22b-instruct',
            prompt: text ? `结合以下需求，一并分析图片要点：${text}` : '请描述这些图片的关键要点。',
            images: visionImages,
          }) });
          const data = await resp.json();
          if (data?.ok && typeof data?.text === 'string' && data.text.trim()) {
            textWithVision = [text, `图片分析：\n${data.text.trim()}`].filter(Boolean).join('\n\n');
          }
        } catch {}
      }

      const messages: ChatMessage[] = [
        systemForJson(),
        // 不再默认注入特性树快照，改由工具自行访问数据源
        ...msgs.map(m=>({role:m.role, content:m.content})) as ChatMessage[],
        { role: "user", content: textWithVision },
      ];
      const { full } = await chatStream({ messages, model: DEFAULT_MODEL, signal: ac.signal, onEvent: (ev: unknown)=>{
        const obj = (ev || {}) as Record<string, unknown>;
        const data = (obj.data ?? {}) as Record<string, unknown>;
        // Normalize name once
        const nm = String(obj.name ?? data.name ?? 'tool');
        const callIdRaw = (obj.call_id ?? obj.tool_call_id ?? obj.id ?? data.id ?? data.tool_call_id) as unknown;
        const callId: string | null = typeof callIdRaw === 'string' ? callIdRaw : (callIdRaw != null ? String(callIdRaw) : null);
        const type = String(obj.type || '');
        if (type === 'tool_start') {
          const ts = Date.now();
          setStage(`正在执行工具「${toolLabel(nm)}」…`);
          // Ephemeral running step indicator (kept for live feedback)
          setSteps(prev => [...prev, { id: `${ts}_${Math.random().toString(36).slice(2,6)}`, name: nm, status: 'running', startedAt: ts }]);
          // Persistent log with input params
          setToolLogs(prev => {
            const inputNorm = normalizeToolInput(data.input ?? obj.input);
            // Dedup: if there's already a running log with same callId or same name+input, don't add another
            const foundIdx = prev.findIndex(l => l.status === 'running' && ((callId && l.callId === callId) || (!callId && l.name === nm && JSON.stringify(l.input) === JSON.stringify(inputNorm))));
            if (foundIdx !== -1) {
              const out = prev.slice();
              out[foundIdx] = { ...out[foundIdx], startedAt: out[foundIdx].startedAt || ts };
              toolLogsRef.current = out;
              return out;
            }
            const out = [...prev, { id: genId('tool'), callId: callId ?? undefined, name: nm, startedAt: ts, status: 'running' as const, input: inputNorm }];
            toolLogsRef.current = out;
            return out;
          });
        } else if (type === 'tool_end') {
          // Mark ephemeral step
          setSteps(prev => {
            const idx = [...prev].reverse().findIndex(s => s.name === nm && s.status === 'running');
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const out = prev.slice();
            out[realIdx] = { ...out[realIdx], status: 'done', endedAt: Date.now() };
            return out;
          });
          // Update persistent log with output
          setToolLogs(prev => {
            const out = prev.slice();
            const now = Date.now();
            let updated = false;
            // Prefer matching by callId
            if (callId) {
              const i = out.findIndex(l => l.status === 'running' && l.callId === callId);
              if (i !== -1) { out[i] = { ...out[i], status: 'done' as const, output: normalizeToolOutput(data.output ?? obj.output), endedAt: now }; updated = true; }
            }
            if (!updated) {
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].name === nm && out[i].status === 'running') { out[i] = { ...out[i], status: 'done' as const, output: normalizeToolOutput(data.output ?? obj.output), endedAt: now }; updated = true; break; }
              }
            }
            toolLogsRef.current = out;
            return out;
          });
          setStage("正在汇总结果…");
          // If a doc library tool changed data, refresh local list to reflect updates
          if (nm === 'create_doc' || nm === 'set_doc_title' || nm === 'set_doc_content' || nm === 'delete_doc') {
            try { loadDocs(); } catch {}
          }
        } else if (type === 'tool_error') {
          // Mark ephemeral step
          setSteps(prev => {
            const idx = [...prev].reverse().findIndex(s => s.name === nm && s.status === 'running');
            const realIdx = idx === -1 ? prev.length - 1 : prev.length - 1 - idx;
            const out = prev.slice();
            if (out[realIdx]) out[realIdx] = { ...out[realIdx], status: 'error', endedAt: Date.now() };
            return out;
          });
          // Update persistent log with error
          setToolLogs(prev => {
            const out = prev.slice();
            const now = Date.now();
            let updated = false;
            if (callId) {
              const i = out.findIndex(l => l.status === 'running' && l.callId === callId);
              if (i !== -1) { out[i] = { ...out[i], status: 'error' as const, error: normalizeToolOutput(data.error ?? obj.error), endedAt: now }; updated = true; }
            }
            if (!updated) {
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].name === nm && out[i].status === 'running') { out[i] = { ...out[i], status: 'error' as const, error: normalizeToolOutput(data.error ?? obj.error), endedAt: now }; updated = true; break; }
              }
            }
            toolLogsRef.current = out;
            return out;
          });
          setStage("正在汇总结果…");
        }
      } });
      setStage("正在汇总结果…");
      let env = tryParseAiEnvelope(full);
      // 尝试宽松处理：若解析成功但不完全满足 Zod 模式，也不强行丢弃，避免丢失可用的 actions
      let envValid = false;
      try { if (env) { ZEnvelope.parse(env as unknown as any); envValid = true; } } catch { envValid = false; }
      if (!env && typeof full === 'string' && full.trim()) {
        // 兜底：提取第一段可能的 JSON（去掉围栏），尝试再次解析
        const raw = full.replace(/^[\s\S]*?```(?:json)?\n([\s\S]*?)```[\s\S]*$/i, '$1').trim();
        try { const maybe = JSON.parse(raw); if (maybe && typeof maybe === 'object') env = maybe as any; } catch {}
      }

      // 先展示：工具调用（聚合气泡，位于回答前面）
      const logsSnap = (toolLogsRef.current || []).slice().sort((a,b)=> a.startedAt - b.startedAt);
      if (logsSnap.length > 0) {
        setMsgs(prev => [...prev, { id: `tools_${Date.now()}`, role: 'assistant', content: '', ts: Date.now(), tools: logsSnap }]);
      }

      // 展示优先级：1) 若存在 answer_md，作为自然语言回答展示；2) 若存在 actions（包含 Feature/Doc 两类），追加统一操作提议卡片
      let showedSomething = false;
      if (env) {
        if (env.answer_md && env.answer_md.trim()) {
          setMsgs(prev => [...prev, { id: `ans_${Date.now()}`, role: 'assistant', content: env!.answer_md!, ts: Date.now() }]);
          showedSomething = true;
        }
        const merged: UnifiedAction[] = [
          ...((env.actions as UnifiedAction[]) || []),
          ...(((env as unknown as { doc_actions?: DocAction[] }).doc_actions || [])),
        ];
        if (merged.length) {
          setMsgs(prev => [...prev, { id: `ops_${Date.now()}`, role: 'assistant', content: '', ts: Date.now(), ops: merged }]);
          showedSomething = true;
        }
      }

      // 若未能解析为 Envelope：以“已净化”的自然语言展示，避免泄露内部 JSON/协议
      if (!showedSomething) {
        const plain = sanitizeAssistantText((full || '').trim());
        if (plain) {
          setMsgs(prev => [...prev, { id: `ans_${Date.now()}`, role: 'assistant', content: plain, ts: Date.now() }]);
          showedSomething = true;
        }
      }
      // 清空当前轮工具日志（已写入到消息流）
      setToolLogs([]); toolLogsRef.current = [];
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); setStage(null); setTimeout(()=> setSteps([]), 1200); }
  }

  function resolveRef(ref: NodeRef | undefined | null): string | null {
    if (!ref) return null;
    if (ref.by === "id") return nodes.find(n => n.id === ref.value)?.id ?? null;
    // by path: support root-level with '/' or ''
    const raw = String(ref.value || '').trim();
    if (raw === '' || raw === '/') return null; // root
    const parts = raw.split("/").map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    let cur: string | null = null;
    let list = nodes.filter(n => n.parentId === null).sort((a,b)=>a.order-b.order);
    for (const name of parts) {
      const m = list.find(n => (n.title || "").trim().toLowerCase() === name.toLowerCase());
      if (!m) return null; cur = m.id; list = nodes.filter(x => x.parentId === cur).sort((a,b)=>a.order-b.order);
    }
    return cur;
  }

  type ApplyResult = { ok: boolean; targetId?: string | null; reason?: string };
  function looksLikeHtml(s: string | undefined | null): boolean {
    if (!s) return false;
    const t = String(s).trim();
    // crude check: contains angle-bracket tags like <p>, <ul>, <h1>, <table>
    return /<\s*\w+[^>]*>/.test(t) && /<\s*\/\s*\w+\s*>/.test(t);
  }

  function applyAction(a: AIAction): ApplyResult {
    try {
      if (a.action === FEATURE_ACTIONS.ADD) {
        // 支持两种模式：
        // 1) 单节点：{ title, ... }
        // 2) 嵌套树：{ nodes: [{ title, children: [...] }, ...] }
        const ext = a as unknown as { nodes?: import("@/types/ai").AddTreeNode[]; index?: number; id?: string; description?: string };
        const pid = resolveRef(a.parent);
        const length = nodes.filter(n => n.parentId === (pid ?? null)).length;
        const baseIdx = typeof ext.index === 'number' ? Math.max(0, Math.min(length, ext.index)) : length;
        // 嵌套树分支
        if (Array.isArray(ext.nodes) && ext.nodes.length > 0) {
          const created: string[] = [];
          const insertTree = (parentId: string | null, items: import("@/types/ai").AddTreeNode[], startIndex: number) => {
            let insertAt = startIndex;
            for (const it of items) {
              const nid = it.id && !nodes.some(n=>n.id===it.id) ? it.id : genId('f');
              const descHtml = looksLikeHtml(it.description) ? (it.description || '') : markdownToHtml(it.description || '');
              doExactAdd({ id: nid, parentId: parentId ?? null, title: it.title, index: insertAt, status: it.status, description: descHtml });
              created.push(nid);
              // 递归子级从 0 开始
              if (Array.isArray(it.children) && it.children.length > 0) insertTree(nid, it.children, 0);
              insertAt += 1;
            }
          };
          insertTree(pid ?? null, ext.nodes, baseIdx);
          if (pid) expandAncestors(pid);
          // 记录首个节点作为 targetId，另存 createdIds 供撤回
          (a as unknown as { __createdIds?: string[] }).__createdIds = created;
          return { ok: true, targetId: created[0] };
        }
        // 单节点分支
        const nid = (ext.id && !nodes.some(n=>n.id===ext.id)) ? ext.id : genId('f');
        const descHtml = looksLikeHtml(ext.description) ? (ext.description || '') : markdownToHtml(ext.description || '');
        doExactAdd({ id: nid, parentId: pid ?? null, title: a.title, index: baseIdx, status: a.status, description: descHtml });
        if (pid) expandAncestors(pid);
        return { ok: true, targetId: nid };
      }
      if (a.action === FEATURE_ACTIONS.ADD_TREE) {
        const anyA = a as Extract<AIAction, { action: typeof FEATURE_ACTIONS.ADD_TREE }>;
        const pid = resolveRef(anyA.parent);
        const length = nodes.filter(n => n.parentId === (pid ?? null)).length;
        const baseIdx = typeof anyA.index === 'number' ? Math.max(0, Math.min(length, anyA.index)) : length;
        const created: string[] = [];
        const insertTree = (parentId: string | null, items: import("@/types/ai").AddTreeNode[], startIndex: number) => {
          let insertAt = startIndex;
          for (const it of items) {
            const nid = it.id && !nodes.some(n=>n.id===it.id) ? it.id : genId('f');
            const descHtml = looksLikeHtml(it.description) ? (it.description || '') : markdownToHtml(it.description || '');
            doExactAdd({ id: nid, parentId: parentId ?? null, title: it.title, index: insertAt, status: it.status, description: descHtml });
            created.push(nid);
            if (Array.isArray(it.children) && it.children.length > 0) insertTree(nid, it.children, 0);
            insertAt += 1;
          }
        };
        insertTree(pid ?? null, anyA.nodes || [], baseIdx);
        if (pid) expandAncestors(pid);
        (a as unknown as { __createdIds?: string[] }).__createdIds = created;
        return { ok: true, targetId: created[0] };
      }
      if (a.action === FEATURE_ACTIONS.RENAME) {
        const tid = resolveRef(a.target); if (!tid) return { ok: false, reason: "未找到目标" };
        doRename({ id: tid, title: a.title });
        expandAncestors(tid);
        return { ok: true, targetId: tid };
      }
      if (a.action === FEATURE_ACTIONS.SET_DESCRIPTION) {
        const tid = resolveRef(a.target); if (!tid) return { ok: false, reason: "未找到目标" };
        const descHtml = looksLikeHtml(a.description) ? (a.description || '') : markdownToHtml(a.description || '');
        doDesc({ id: tid, description: descHtml });
        expandAncestors(tid);
        return { ok: true, targetId: tid };
      }
      if (a.action === FEATURE_ACTIONS.SET_STATUS) {
        const tid = resolveRef(a.target); if (!tid) return { ok: false, reason: "未找到目标" };
        doStatus({ id: tid, status: a.status });
        expandAncestors(tid);
        return { ok: true, targetId: tid };
      }
      if (a.action === FEATURE_ACTIONS.MOVE) {
        const tid = resolveRef(a.target); const pid = resolveRef(a.parent);
        if (!tid) return { ok: false, reason: "未找到目标" };
        const length = nodes.filter(n => n.parentId === (pid ?? null)).length;
        doMove({ id: tid, newParentId: pid ?? null, newIndex: typeof a.index === 'number' ? Math.max(0, Math.min(length, a.index)) : length });
        expandAncestors(tid);
        return { ok: true, targetId: tid };
      }
      if (a.action === FEATURE_ACTIONS.DELETE) {
        const tid = resolveRef(a.target); if (!tid) return { ok: false, reason: "未找到目标" };
        doDel(tid);
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    return { ok: false, reason: "未知操作" };
  }

  // removed batch-apply helper (applyOps); ops 逐条点击应用

  function expandAncestors(id: string) {
    // ensure all ancestors expanded for visibility
    setNodes((prev) => {
      const map = new Map(prev.map(n=>[n.id,n] as const));
      const out = prev.map(n=> ({...n}));
      let cur = map.get(id);
      const visit = (nid: string | undefined | null, guard = 0) => {
        if (!nid) return;
        if (guard > out.length + 5) return;
        const node = map.get(nid);
        if (!node) return;
        if (node.parentId) {
          const p = out.find(x => x.id === node.parentId);
          if (p && p.collapsed) p.collapsed = false;
          visit(node.parentId, guard + 1);
        }
      };
      visit(id, 0);
      return out;
    });
  }

  function scrollAndFlash(id: string) {
    // wait a tick for DOM to reflect
    setTimeout(() => {
      const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
        el.classList.add('flash-highlight');
        setTimeout(()=> el.classList.remove('flash-highlight'), 1200);
      }
    }, 60);
  }

  function renderUserTextWithMentions(text: string): React.ReactNode {
    if (!text) return null;
    const parts: React.ReactNode[] = [];
    // Handle product first, then doc
    const reProd = /@\[(.+?)\]\(prod:\/\/([^\)]+)\)/g;
    const reDoc = /@\[(.+?)\]\(doc:\/\/([^\)]+)\)/g;
    let last = 0; let m: RegExpExecArray | null;
    // merge pass: find earliest next match of either
    while (true) {
      const mp = reProd.exec(text);
      const md = reDoc.exec(text);
      const next = [mp, md].filter(Boolean).sort((a:any,b:any)=> (a!.index)-(b!.index))[0] as RegExpExecArray | undefined;
      if (!next) break;
      const idx = next.index;
      if (idx > last) parts.push(text.slice(last, idx));
      const label = next[1];
      if (next === mp) parts.push(<ProdChip key={`prodm_${idx}`} label={label} />);
      else parts.push(<DocChip key={`docm_${idx}`} label={label} />);
      last = idx + next[0].length;
      // skip duplicate label/@
      let k = last; while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === '@') last = k + 1; else if (label && text.substr(k, label.length) === label) last = k + label.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
  }

  function escapeHtmlAttr(s: string) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;"); }
  function escapeHtmlText(s: string) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function htmlWithMentionsFromMarkdown(raw: string): string {
    const encoded = (raw || '').replace(/@\[(.+?)\]\(doc:\/\/([^\)]+)\)/g, (_m, label, id) => `§§DOCM::${encodeURIComponent(id)}::${encodeURIComponent(label)}::DOCM§§`);
    const encoded2 = encoded.replace(/@\[(.+?)\]\(prod:\/\/([^\)]+)\)/g, (_m, label, id) => `§§PRODM::${encodeURIComponent(id)}::${encodeURIComponent(label)}::PRODM§§`);
    let html = markdownToHtml(encoded2);
    html = html.replace(/§§DOCM::([^:]+)::([^:]+)::DOCM§§/g, (_m, idEnc, labelEnc) => {
      const id = escapeHtmlAttr(decodeURIComponent(String(idEnc||'')));
      const label = escapeHtmlText(decodeURIComponent(String(labelEnc||'')));
      const cls = DOC_CHIP_CLASS;
      return `<span data-doc-mention="1" data-id="${id}" data-label="${label}" class="${cls}"><span class="opacity-80 mr-0.5">@<\/span><span>${label}<\/span><\/span>`;
    });
    html = html.replace(/§§PRODM::([^:]+)::([^:]+)::PRODM§§/g, (_m, idEnc, labelEnc) => {
      const id = escapeHtmlAttr(decodeURIComponent(String(idEnc||'')));
      const label = escapeHtmlText(decodeURIComponent(String(labelEnc||'')));
      const cls = PROD_CHIP_CLASS;
      return `<span data-prod-mention="1" data-id="${id}" data-label="${label}" class="${cls}"><span class="opacity-80 mr-0.5">@<\/span><span>${label}<\/span><\/span>`;
    });
    return html;
  }

  function refText(ref: NodeRef | null | undefined): string {
    if (!ref) return "";
    if (ref.by === "path") return ref.value || "";
    const n = nodes.find(x => x.id === ref.value);
    return n ? (n.title || n.id) : ref.value;
  }

  function primaryLine(a: AIAction): string {
    if (a.action === FEATURE_ACTIONS.ADD) {
      const anyA: any = a as any;
      if (Array.isArray(anyA.nodes) && anyA.nodes.length > 0) return `批量新增 ${anyA.nodes.length} 个节点 至 ${refText(a.parent)}`;
      return `新增 "${a.title}" 至 ${refText(a.parent)}`;
    }
    if ((a as any).action === (FEATURE_ACTIONS as any).ADD_TREE) {
      const anyA: any = a as any;
      const count = Array.isArray(anyA.nodes) ? anyA.nodes.length : 0;
      return `批量新增 ${count} 个节点 至 ${refText((anyA as any).parent)}`;
    }
    if (a.action === FEATURE_ACTIONS.RENAME) return `重命名 ${refText(a.target)} → "${a.title}"`;
    if (a.action === FEATURE_ACTIONS.SET_DESCRIPTION) return `设置描述：${refText(a.target)}`;
    if (a.action === FEATURE_ACTIONS.SET_STATUS) return `设置状态：${refText(a.target)}`;
    if (a.action === FEATURE_ACTIONS.MOVE) return `移动 ${refText(a.target)} → ${refText(a.parent)}`;
    if (a.action === FEATURE_ACTIONS.DELETE) return `删除 ${refText(a.target)}`;
    return "";
  }

  // ---- 文档库提议卡片 ----
  function resolveDocRef(ref: DocRef | null | undefined): string | null {
    if (!ref) return null;
    if (ref.by === 'id') return (docs || []).find(d => d.id === ref.value)?.id ?? null;
    const target = (docs || []).find(d => (d.title || '').trim().toLowerCase() === String(ref.value || '').trim().toLowerCase());
    return target ? target.id : null;
  }
  function docRefLabel(ref: DocRef | null | undefined): string {
    if (!ref) return '';
    if (ref.by === 'title') return ref.value || '';
    // by id: prefer existing title from docs list
    const item = (docs || []).find(d => d.id === ref.value);
    if (item && item.title && item.title.trim()) return item.title;
    return ref.value || '';
  }
  function docPrimaryLine(a: DocAction): string {
    if (a.action === DOC_ACTIONS.DOC_CREATE) return `新建文档 "${a.title}"`;
    if (a.action === DOC_ACTIONS.DOC_RENAME) return `重命名文档 ${docRefLabel(a.target)} → "${a.title}"`;
    if (a.action === DOC_ACTIONS.DOC_SET_CONTENT) return `写入文档：${docRefLabel(a.target)}`;
    if ((a as any).action === (DOC_ACTIONS as any).DOC_PATCH) return `局部修改：${docRefLabel((a as any).target)}（${(a as any).format || 'search_replace'}）`;
    if (a.action === DOC_ACTIONS.DOC_DELETE) return `删除文档：${docRefLabel(a.target)}`;
        return '';
  }

  function lineForAction(a: UnifiedAction): string {
    const act = String((a as any).action || '');
    if (act.startsWith('doc_')) return docPrimaryLine(a as DocAction);
    if (act.startsWith('product_')) {
      if (act === PRODUCT_ACTIONS.PRODUCT_CREATE) return `新建产品："${(a as any).name || '未命名'}"`;
      if (act === PRODUCT_ACTIONS.PRODUCT_SELECT) return `切换到产品：${(a as any).id || ''}`;
      return '';
    }
    return primaryLine(a as AIAction);
  }
  async function applyDocAction(a: DocAction): Promise<{ ok: boolean; targetId?: string | null; reason?: string }> {
    try {
      if (a.action === DOC_ACTIONS.DOC_CREATE) {
        const id = a.id && !(docs||[]).some(d=>d.id===a.id) ? a.id : genId('doc');
        const html = a.content_md ? markdownToHtml(a.content_md) : '';
        await createExact({ id, title: a.title, content_html: html, select: false } as any);
        return { ok: true, targetId: id };
      }
      if (a.action === DOC_ACTIONS.DOC_RENAME) {
        const id = resolveDocRef(a.target); if (!id) return { ok: false, reason: 'not_found' };
        await setDocTitle({ id, title: a.title } as any);
        return { ok: true, targetId: id };
      }
      if (a.action === DOC_ACTIONS.DOC_SET_CONTENT) {
        const id = resolveDocRef(a.target); if (!id) return { ok: false, reason: 'not_found' };
        const html = markdownToHtml(a.content_md || '');
        await setDocContent({ id, content: html } as any);
        return { ok: true, targetId: id };
      }
      if (a.action === DOC_ACTIONS.DOC_DELETE) {
        const id = resolveDocRef(a.target); if (!id) return { ok: false, reason: 'not_found' };
        await removeDoc(id as any);
        return { ok: true, targetId: id };
      }
      return { ok: false, reason: 'unknown_action' };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  // status/display helpers for action rows moved to ActionProposals component

  // Inline editors removed

  return (
    <div className={cn("h-full w-full flex flex-col", className)}>
      <div className="flex h-11 items-center justify-between gap-2 border-b px-3 rounded-t-xl bg-muted/30">
        {/* 标题使用中文 */}
        <div className="inline-flex items-center gap-2 text-sm font-medium"><MessageSquareText className="size-4" />Panova Copilot</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 cursor-pointer" onClick={reset}><RotateCcw className="size-4" /><span className="ml-1">重置</span></Button>
          {onClose && (
            <Button type="button" size="icon" variant="ghost" onClick={onClose} className="h-7 w-7 cursor-pointer">
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
            </Button>
          )}
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-auto px-4 py-3 space-y-4 overscroll-contain relative">
        {msgs.map(m => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}> 
            {m.role === "user" ? (
              <div className={cn("max-w-[90%] rounded-lg px-3 py-2 text-sm/7 bg-white border border-gray-200 text-gray-900")}
              >
                <div className="whitespace-pre-wrap">{renderUserTextWithMentions(m.content)}</div>
                {Array.isArray((m as any).images) && (m as any).images.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(m as any).images.map((url: string, i: number) => (
                      <div key={`${m.id}_img_${i}`} className="relative border rounded-md overflow-hidden bg-muted">
                        <img src={url} alt={`image_${i+1}`} className="object-cover w-full h-full max-h-32" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (m as any).tools && (m as any).tools.length > 0 ? (
              // 工具调用聚合气泡（每条默认折叠，点击展开详情）
              (() => {
                const logs = (m as any).tools as ToolLog[];
                return (
                  <div className="rounded-md border bg-card px-3 py-2 text-xs text-foreground/90 w-full max-w-[90%]">
                    <div className="mb-1 opacity-70">工具调用</div>
                    <div className="space-y-1">
                      {logs.map((log) => {
                        const openKey = `${m.id}:${log.id}`;
                        const open = !!openTool[openKey];
                        const statusEl = log.status === 'running'
                          ? (<span className="inline-flex items-center justify-center size-4 rounded-full border bg-muted relative overflow-hidden"><span className="absolute inset-0 shimmer-bg" /></span>)
                          : log.status === 'done'
                            ? (<span className="inline-flex items-center justify-center size-4 rounded-full bg-emerald-500 text-white">✓</span>)
                            : (<span className="inline-flex items-center justify-center size-4 rounded-full bg-red-500 text-white">!</span>);
                        const toggle = () => setOpenTool((mm)=> ({ ...mm, [openKey]: !open }));
                        const dur = (log.endedAt && log.startedAt) ? (log.endedAt - log.startedAt) : undefined;
                        return (
                          <div key={log.id} className="rounded hover:bg-muted/60 transition-colors">
                            <div
                              className="flex items-center gap-2 py-1 px-2 cursor-pointer select-none"
                              onClick={toggle}
                              aria-expanded={open}
                              title="查看调用详情"
                            >
                              {statusEl}
                              <span className="text-foreground/90">{toolLabel(log.name)}</span>
                              {typeof dur === 'number' && (
                                <span className="ml-2 text-[11px] text-muted-foreground">{formatDuration(dur)}</span>
                              )}
                              <ChevronDown className={cn("size-3.5 ml-auto text-muted-foreground transition-transform", open ? "rotate-180" : "rotate-0")} />
                            </div>
                            {open && (
                              <div className="px-3 pb-2">
                                {log.input !== undefined && (
                                  <div className="mb-1">
                                    <div className="text-[11px] text-muted-foreground mb-0.5">参数</div>
                                    <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.input)}</div>
                                  </div>
                                )}
                                {log.status === 'done' && log.output !== undefined && (
                                  <div className="mb-1">
                                    <div className="text-[11px] text-muted-foreground mb-0.5">输出</div>
                                    <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.output)}</div>
                                  </div>
                                )}
                                {log.status === 'error' && log.error !== undefined && (
                                  <div className="mb-1">
                                    <div className="text-[11px] text-muted-foreground mb-0.5">错误</div>
                                    <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.error)}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            ) : (m.ops && m.ops.length > 0) ? (
              <ActionProposals
                actions={m.ops as UnifiedAction[]}
                states={m.opStates as Record<number, UIOpState>}
                lineForAction={lineForAction}
                onApply={(i,op)=>{ void applyProposedUnified(m.id, i, op); }}
                onIgnore={(i,op)=>{ ignoreProposed(m.id, i, op); }}
                onUndo={(i,op)=>{ void undoProposedUnified(m.id, i, op); }}
                onApplyAll={() => { void applyAllForMessage(m.id); }}
              />
            ) : (
              (() => { const text = (m.content || '').trim(); if (!text) return null; const html = htmlWithMentionsFromMarkdown(text); return (
                <div className={cn("max-w-[90%] rounded-lg px-3 py-2 text-sm/7 bg-white border border-gray-200 text-gray-900 prose prose-sm")} dangerouslySetInnerHTML={{ __html: html }} />
              ); })()
            )}
          </div>
        ))}
        {/* 工具调用（聚合为一个气泡，默认折叠每一项） */}
        {toolLogs.length > 0 && (
          <div className="flex justify-start">
            <div className="rounded-md border bg-card px-3 py-2 text-xs text-foreground/90 w-full max-w-[90%]">
              <div className="mb-1 opacity-70">工具调用</div>
              <div className="space-y-1">
                {toolLogs.map((log) => {
                  const open = !!openTool[log.id];
                  const statusEl = log.status === 'running'
                    ? (<span className="inline-flex items-center justify-center size-4 rounded-full border bg-muted relative overflow-hidden"><span className="absolute inset-0 shimmer-bg" /></span>)
                    : log.status === 'done'
                      ? (<span className="inline-flex items-center justify-center size-4 rounded-full bg-emerald-500 text-white">✓</span>)
                      : (<span className="inline-flex items-center justify-center size-4 rounded-full bg-red-500 text-white">!</span>);
                  const toggle = () => setOpenTool((m)=> ({ ...m, [log.id]: !open }));
                  const dur = (log.endedAt && log.startedAt) ? (log.endedAt - log.startedAt) : undefined;
                  return (
                    <div key={log.id} className="rounded hover:bg-muted/60 transition-colors">
                      <div
                        className="flex items-center gap-2 py-1 px-2 cursor-pointer select-none"
                        onClick={toggle}
                        aria-expanded={open}
                        title="查看调用详情"
                      >
                        {statusEl}
                        <span className="text-foreground/90">{toolLabel(log.name)}</span>
                        {typeof dur === 'number' && (
                          <span className="ml-2 text-[11px] text-muted-foreground">{formatDuration(dur)}</span>
                        )}
                        <ChevronDown className={cn("size-3.5 ml-auto text-muted-foreground transition-transform", open ? "rotate-180" : "rotate-0")} />
                      </div>
                      {open && (
                        <div className="px-3 pb-2">
                          {log.input !== undefined && (
                            <div className="mb-1">
                              <div className="text-[11px] text-muted-foreground mb-0.5">参数</div>
                              <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.input)}</div>
                            </div>
                          )}
                          {log.status === 'done' && log.output !== undefined && (
                            <div className="mb-1">
                              <div className="text-[11px] text-muted-foreground mb-0.5">输出</div>
                              <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.output)}</div>
                            </div>
                          )}
                          {log.status === 'error' && log.error !== undefined && (
                            <div className="mb-1">
                              <div className="text-[11px] text-muted-foreground mb-0.5">错误</div>
                              <div className="rounded border bg-background p-2 whitespace-pre-wrap break-words text-[12px]">{renderValue(log.error)}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {stage ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[12px] text-foreground/90 bg-card relative overflow-hidden">
              <span className="absolute inset-0 pointer-events-none shimmer-bg" />
              <Loader2 className="size-3.5 animate-spin opacity-80" />
              <span className="relative">{stage}</span>
            </div>
          </div>
        ) : null}
        {error && (<div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>)}
      </div>

      {/* 文档全量写入的 Diff 预览（已取消弹窗展示，改为卡片内预览） */}

      {/* 局部补丁的 Diff 预览（Monaco） */}
      {/* 局部补丁预览弹窗已移除 */}

      {/* 文档写入二次确认弹窗（最小化实现；复用 Dialog） */}
      <Dialog open={false && !!docConfirm} onOpenChange={(open)=>{ if (!open) setDocConfirm(null); }}>
        <DialogContent className="max-w-[860px]">
          <DialogHeader>
            <DialogTitle>确认写入文档{docConfirm?.docTitle ? `："${docConfirm.docTitle}"` : ''}</DialogTitle>
            <DialogDescription>将以 Markdown 全量覆盖当前文档内容，请确认。</DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border bg-muted/40 p-2">
              <div className="text-[11px] text-muted-foreground mb-1">当前内容（Markdown 近似还原）</div>
              <pre className="text-xs whitespace-pre-wrap break-words max-h-[280px] overflow-auto">{docConfirm?.beforeMd || ''}</pre>
            </div>
            <div className="rounded border bg-muted/40 p-2">
              <div className="text-[11px] text-muted-foreground mb-1">新内容（将要写入）</div>
              <pre className="text-xs whitespace-pre-wrap break-words max-h-[280px] overflow-auto">{docConfirm?.afterMd || ''}</pre>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-7 px-3 cursor-pointer" onClick={()=> setDocConfirm(null)}>取消</Button>
            <Button
              type="button"
              className="h-7 px-3 cursor-pointer"
              onClick={async ()=>{
                const payload = docConfirm; if (!payload) return;
                setOpState(payload.msgId, payload.index, { status: 'applying', error: undefined });
                try {
                  const r = await applyDocAction(payload.op);
                  if (!r.ok) { setOpState(payload.msgId, payload.index, { status: 'failed', error: r.reason || 'unknown' }); setDocConfirm(null); return; }
                  // 标记已应用并记录 prevHtml 用于撤回
                  setMsgs(prev => prev.map(m => m.id===payload.msgId ? ({ ...m, opStates: { ...(m.opStates||{}), [payload.index]: { ...(m.opStates?.[payload.index]||{status:'applied'}), id: payload.docId, prevHtml: (docs||[]).find(x=>x.id===payload.docId)?.content || '', status: 'applied', error: undefined } } }) : m));
                  try { loadDocs(); } catch {}
                  showToast({ title: '已写入', description: '文档内容已更新。', variant: 'success' });
                } catch (e) {
                  setOpState(payload.msgId, payload.index, { status: 'failed', error: e instanceof Error ? e.message : String(e) });
                } finally {
                  setDocConfirm(null);
                }
              }}
            >确认应用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="py-2 px-3">
        <form
          onSubmit={(e)=>{ e.preventDefault(); sendOrPause(); }}
          onKeyDown={(e)=>{
            const comp = (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing;
            // Send only on Cmd/Ctrl+Enter; let plain Enter be handled by the editor (mentions/newline)
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !comp) { e.preventDefault(); sendOrPause(); return; }
            // Hint: after typing '@', schedule mention check
            if (e.key === '@') { setTimeout(openMentionIfNeeded, 0); }
          }}
          className="flex flex-col gap-2"
        >
          <div className="relative" onPaste={handlePaste}>
            <TiptapEditor
              value={inputHtml}
              onChange={(html)=>{ setInputHtml(html); setTimeout(openMentionIfNeeded, 0); }}
              onEditorReady={(ed)=>{ inputEditorRef.current = ed; }}
              extraExtensions={[DocMention, ProdMention, mentionKeyExt]}
              compact
              placeholder="输入消息…"
              className="min-h-[96px] prose-xs text-sm"
              containerClassName="rounded-md border p-1 bg-background text-xs overflow-hidden"
              innerScrollClassName="max-h-[200px] overflow-auto hide-scrollbar pr-9"
              overlay={
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0 cursor-pointer shadow-xs hover:shadow-sm transition-shadow bg-gray-200 text-gray-900 hover:bg-gray-300 border border-gray-300"
                  disabled={!stripHtml(inputHtml).trim() && !loading}
                  aria-label={loading ? '暂停' : '发送 (Cmd/Ctrl+Enter)'}
                  title={loading ? '暂停' : '发送 (Cmd/Ctrl+Enter)'}
                >
                  {loading ? (<Pause className="size-5" />) : (<ArrowUp className="size-5" />)}
                </Button>
              }
            />
            {mentionOpen ? (
              (() => {
                if (!mentionItems || mentionItems.length === 0) {
                  return (
                    <div className="absolute left-0 right-0 bottom-full mb-1 rounded-md border bg-card shadow-xs text-sm text-muted-foreground">
                      <div className="px-2 py-1.5">未找到匹配项。可在左侧新建产品或文档，或先发送消息。</div>
                    </div>
                  );
                }
                const prods = mentionItems.filter(x=>x.kind==='prod');
                const docsList = mentionItems.filter(x=>x.kind==='doc');
                let gi = -1;
                return (
                  <div className="absolute left-0 right-0 bottom-full mb-1 max-h-56 overflow-auto rounded-md border bg-card shadow-xs text-sm">
                    {prods.length>0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground flex items-center gap-1">特性树</div>
                    ) : null}
                    {prods.map((it) => { gi++; const idx=gi; return (
                      <div key={`prod_${it.id}_${idx}`} className={cn("px-2 py-1.5 cursor-pointer flex items-center gap-2", idx === mentionIdx ? "bg-muted" : "hover:bg-muted/80")}
                        onMouseEnter={() => setMentionIdx(idx)}
                        onMouseDown={(e) => { e.preventDefault(); applyMention(it); }}
                      >
                        <AppWindowMac className="size-3.5 text-muted-foreground" />
                        <span className="truncate">{it.label}</span>
                      </div>
                    );})}
                    {docsList.length>0 ? (
                      <div className="px-2 py-1 text-[11px] text-muted-foreground flex items-center gap-1 bg-muted/30">文档库</div>
                    ) : null}
                    {docsList.map((it) => { gi++; const idx=gi; return (
                      <div key={`doc_${it.id}_${idx}`} className={cn("px-2 py-1.5 cursor-pointer flex items-center gap-2", idx === mentionIdx ? "bg-muted" : "hover:bg-muted/80")}
                        onMouseEnter={() => setMentionIdx(idx)}
                        onMouseDown={(e) => { e.preventDefault(); applyMention(it); }}
                      >
                        <DocIcon className="size-3.5 text-muted-foreground" />
                        <span className="truncate">{it.label}</span>
                      </div>
                    );})}
                  </div>
                );
              })()
            ) : null}
            {images.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map((im) => (
                  <div key={im.id} className="relative group border rounded-md overflow-hidden w-10 aspect-square bg-muted">
                    <img src={im.url} alt="paste" className="object-cover w-full h-full" />
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 hidden group-hover:block bg-gray-900/80 text-white rounded-full h-5 w-5 text-[10px] leading-5 text-center"
                      onClick={() => removeImage(im.id)}
                      aria-label="移除图片"
                      title="移除图片"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------- AI prompt helpers centralized in src/lib/ai/prompt.ts, utils in src/lib/ai/utils.ts ----------

// Pretty render of values for tool logs: compact JSON or primitives
function renderValue(v: any): React.ReactNode {
  try {
    if (v === null) return <span className="text-muted-foreground">null</span>;
    if (typeof v === 'string') return <span>{v}</span>;
    if (typeof v === 'number' || typeof v === 'boolean') return <span>{String(v)}</span>;
    return <pre className="m-0 leading-5 whitespace-pre-wrap break-words">{JSON.stringify(v, null, 2)}</pre>;
  } catch {
    return <span>{String(v)}</span>;
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  if (ms >= 1000) return `${(ms/1000).toFixed(2)}s`;
  return `${Math.max(0, Math.round(ms))}ms`;
}

// --- Tool I/O normalization helpers ---
function tryParseJsonLoose(v: unknown): any {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  try { return JSON.parse(s); } catch {}
  // Try to parse relaxed JSON where single quotes may appear (best-effort)
  try { if ((s.startsWith('{') || s.startsWith('[')) && s.includes(':')) return JSON.parse(s.replace(/\b'([^']*)'\b/g, '"$1"')); } catch {}
  return undefined;
}

function normalizeToolInput(input: any): any {
  // Common patterns:
  // - stringified JSON
  // - { input: '...json...' }
  // - { kwargs: { content: '...json...' } }
  if (input == null) return input;
  if (typeof input === 'string') {
    const maybe = tryParseJsonLoose(input);
    return maybe !== undefined ? maybe : input;
  }
  if (typeof input === 'object') {
    const anyInput = input as any;
    if (typeof anyInput.input === 'string') {
      const maybe = tryParseJsonLoose(anyInput.input);
      return maybe !== undefined ? maybe : input;
    }
    if (anyInput?.kwargs && typeof anyInput.kwargs.content === 'string') {
      const maybe = tryParseJsonLoose(anyInput.kwargs.content);
      return maybe !== undefined ? maybe : input;
    }
  }
  return input;
}

function normalizeToolOutput(output: any): any {
  // Similar to input; additionally unwrap ToolMessage-like structure
  if (output == null) return output;
  if (typeof output === 'string') {
    const maybe = tryParseJsonLoose(output);
    return maybe !== undefined ? maybe : output;
  }
  if (typeof output === 'object') {
    const anyOut = output as any;
    if (anyOut?.kwargs && typeof anyOut.kwargs.content === 'string') {
      const maybe = tryParseJsonLoose(anyOut.kwargs.content);
      return maybe !== undefined ? maybe : anyOut.kwargs.content;
    }
    if (typeof anyOut.output === 'string') {
      const maybe = tryParseJsonLoose(anyOut.output);
      return maybe !== undefined ? maybe : anyOut.output;
    }
  }
  return output;
}

// JSON viewer: we render compact JSON via renderValue to keep UI simple and readable
