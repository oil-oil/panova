"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from "react";
import type { UnifiedAction, DocAction, FeatureAction, AddTreeNode, DocRef } from "@/types/ai";
import { FEATURE_ACTIONS, FEATURE_STATUS_META, PRODUCT_ACTIONS } from "@/lib/ai/actions";
import type { FeatureStatus } from "@/types/feature-tree";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, Pencil, FileText, CheckCircle2, ArrowRight, Trash } from "lucide-react";
import { diffLines } from "diff";
import { applyDocSearchReplacePatch } from "@/lib/patch/mkpatch";

export type OpState = { status: 'pending'|'applying'|'applied'|'failed'|'ignored'|'undoing'; error?: string };

export default function ActionProposals(props: {
  actions: UnifiedAction[];
  states?: Record<number, OpState>;
  lineForAction: (a: UnifiedAction) => string;
  onApply: (idx: number, a: UnifiedAction) => void | Promise<void>;
  onIgnore: (idx: number, a: UnifiedAction) => void | Promise<void>;
  onUndo: (idx: number, a: UnifiedAction) => void | Promise<void>;
  onApplyAll?: () => void | Promise<void>;
  resolveDocMd?: (ref: DocRef) => string;
}) {
  const { actions, states, lineForAction, onApply, onIgnore, onUndo, onApplyAll, resolveDocMd } = props;
  const [open, setOpen] = React.useState<Record<number, boolean>>({});

  function ActionIcon({ a }: { a: UnifiedAction }) {
    const cls = "h-3.5 w-3.5";
    const act = (a as any).action as string;
    if (act.startsWith('doc_')) return <FileText className={cls} />;
    if (act === PRODUCT_ACTIONS.PRODUCT_CREATE) return <Plus className={cls} />;
    if (act === PRODUCT_ACTIONS.PRODUCT_SELECT) return <CheckCircle2 className={cls} />;
    if (act === FEATURE_ACTIONS.ADD) return <Plus className={cls} />;
    if (FEATURE_ACTIONS.ADD_TREE && act === FEATURE_ACTIONS.ADD_TREE) return <Plus className={cls} />;
    if (act === FEATURE_ACTIONS.RENAME) return <Pencil className={cls} />;
    if (act === FEATURE_ACTIONS.SET_DESCRIPTION) return <FileText className={cls} />;
    if (act === FEATURE_ACTIONS.SET_STATUS) return <CheckCircle2 className={cls} />;
    if (act === FEATURE_ACTIONS.MOVE) return <ArrowRight className={cls} />;
    if (act === FEATURE_ACTIONS.DELETE) return <Trash className={cls} />;
    return null;
  }

  // Compact status chip for preview
  function StatusChip({ s }: { s?: FeatureStatus }) {
    const meta = s ? FEATURE_STATUS_META[s] : undefined;
    if (!meta) return null;
    return <span className={`inline-flex items-center rounded border px-1 py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>;
  }

  function renderAddNodesPreview(nodes: AddTreeNode[], depth = 0, remain = 40): React.ReactNode {
    if (!Array.isArray(nodes) || nodes.length === 0 || remain <= 0) return null;
    const list = nodes.slice(0, Math.max(0, remain));
    return (
      <ul className="mt-1 space-y-1">
        {list.map((n, idx) => {
          const title = String(n?.title || '').trim() || '未命名';
          const desc = String(n?.description || '').trim();
          const hasChildren = Array.isArray(n?.children) && n.children.length > 0;
          const childRemain = Math.max(0, remain - idx - 1);
          return (
            <li key={idx} className="pl-2 border-l">
              <div className="flex items-center gap-2">
                <span className="text-[13px]">{title}</span>
                {n?.status ? (<StatusChip s={n.status} />) : null}
              </div>
              {desc ? (<div className="text-[12px] text-muted-foreground mt-0.5 whitespace-pre-wrap">{desc.slice(0, 160)}{desc.length>160?'…':''}</div>) : null}
              {hasChildren ? renderAddNodesPreview(n.children, depth + 1, childRemain) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  const renderBody = (op: UnifiedAction) => {
    const act = String((op as any).action || '');
    if (act.startsWith('doc_')) {
      const d = op as DocAction;
      // Inline red/green diff preview (默认展开，无折叠)
      try {
        if (d.action === 'doc_set_content') {
          const beforeMd = resolveDocMd ? resolveDocMd(d.target) : '';
          const afterMd = (d as any).content_md || '';
          return renderMdDiff(beforeMd, afterMd);
        }
        if ((d as any).action === 'doc_patch') {
          const fmt: string = String((d as any).format || 'search_replace');
          const beforeMd = resolveDocMd ? resolveDocMd((d as any).target) : '';
          let afterMd = beforeMd;
          if (fmt === 'search_replace') afterMd = applyDocSearchReplacePatch(beforeMd, String((d as any).patch || ''));
          // udiff: 暂不应用，展示原文与原文的零差异以提示需切换为 search_replace 或稍后支持
          return renderMdDiff(beforeMd, afterMd);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return <div className="mt-1 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">预览失败：{msg}</div>;
      }
      return null;
    }
    if ((op as FeatureAction).action === FEATURE_ACTIONS.ADD_TREE) {
      const addTree = op as Extract<FeatureAction, { action: typeof FEATURE_ACTIONS.ADD_TREE }>;
      const idx = actions.indexOf(op);
      const nodesLen = addTree.nodes.length;
      const isOpenRaw = open[idx];
      const isOpen = (isOpenRaw === undefined) ? true : !!isOpenRaw; // 默认展开
      return (
        <div className="mt-1">
          <div className="text-xs text-muted-foreground mb-1">
            批量结构预览 <button type="button" className="underline cursor-pointer" onClick={()=> setOpen((m)=>({ ...m, [idx]: !isOpen }))}>{isOpen ? '收起' : '展开'}</button>
          </div>
          {isOpen ? (
            <div className="rounded border bg-background p-2">
              {renderAddNodesPreview(addTree.nodes, 0, 60)}
            </div>
          ) : (
            (() => {
              const tops = addTree.nodes.slice(0, 6).map((n)=> String(n?.title||'未命名'));
              const more = nodesLen - tops.length;
              return (
                <div className="text-[12px] text-muted-foreground">
                  概览：{tops.join('、')}{more>0 ? ` 等，共 ${nodesLen} 项` : ''}
                </div>
              );
            })()
          )}
        </div>
      );
    }
    const desc = ((op as FeatureAction).action === FEATURE_ACTIONS.SET_DESCRIPTION)
      ? (op as Extract<FeatureAction, { action: typeof FEATURE_ACTIONS.SET_DESCRIPTION }>).description
      : ((op as FeatureAction).action === FEATURE_ACTIONS.ADD
        ? ((op as Extract<FeatureAction, { action: typeof FEATURE_ACTIONS.ADD }>).description || '')
        : '');
    return desc ? (<div className="mt-1 text-xs text-foreground/90 whitespace-pre-wrap">{desc}</div>) : null;
  };

  return (
    <div className={cn("w-full rounded-lg px-3 py-2 text-sm bg-muted text-foreground")}> 
      <div className="mb-2 text-xs text-muted-foreground flex items-center justify-between">
        <span>检测到 {actions.length} 个操作提议</span>
        {onApplyAll ? (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] cursor-pointer"
            onClick={() => { void onApplyAll(); }}
          >全部应用</Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {actions.map((op, i) => {
          const st = (states && states[i]) || { status: 'pending' } as OpState;
          const s = st.status;
          const disabled = s === 'applying' || s === 'undoing';
          return (
            <div key={i} className="rounded-md border bg-card px-3 py-2">
              {/* Header: icon + title aligned center */}
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center h-6 w-6 rounded-md border bg-muted text-muted-foreground shrink-0">
                  <ActionIcon a={op} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm flex items-center flex-wrap gap-2">
                    <span className="leading-6">{lineForAction(op)}</span>
                    {s === 'applied' ? (<span className="inline-flex items-center rounded border border-emerald-300 bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[11px]">已应用</span>) : null}
                    {s === 'ignored' ? (<span className="inline-flex items-center rounded border border-gray-300 bg-gray-100 text-gray-700 px-1.5 py-0.5 text-[11px]">已忽略</span>) : null}
                    {s === 'failed' && st.error ? (<span className="inline-flex items-center rounded border border-red-300 bg-red-100 text-red-800 px-1.5 py-0.5 text-[11px]">失败：{st.error.slice(0,48)}</span>) : null}
                  </div>
                </div>
              </div>
              {/* Body and actions indented to align under the title text */}
              {renderBody(op) ? (
                <div className="mt-2 pl-9">
                  {renderBody(op)}
                </div>
              ) : null}
              <div className="mt-2 pl-9 flex justify-end gap-2">
                {s === 'pending' || s === 'failed' ? (
                  <Button size="sm" variant="outline" className="h-6 px-3 text-[11px] cursor-pointer" disabled={disabled}
                    onClick={()=>{ void onApply(i, op); }}
                  >{s === 'failed' ? '重试应用' : '应用'}</Button>
                ) : null}
                {s === 'pending' ? (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] cursor-pointer" disabled={disabled}
                    onClick={()=>{ void onIgnore(i, op); }}
                  >忽略</Button>
                ) : null}
                {s === 'applied' ? (
                  <Button size="sm" variant="outline" className="h-6 px-3 text-[11px] cursor-pointer" disabled={disabled}
                    onClick={()=>{ void onUndo(i, op); }}
                  >撤回</Button>
                ) : null}
                {s === 'ignored' ? (
                  <Button size="sm" variant="outline" className="h-6 px-3 text-[11px] cursor-pointer" disabled={disabled}
                    onClick={()=>{ void onUndo(i, op); }}
                  >恢复</Button>
                ) : null}
                {s === 'applying' ? (<span className="text-xs text-foreground/70">应用中…</span>) : null}
                {s === 'undoing' ? (<span className="text-xs text-foreground/70">撤回中…</span>) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderMdDiff(before: string, after: string): React.ReactNode {
  const parts = diffLines(before || '', after || '');
  return (
    <div className="mt-2 rounded border bg-background">
      <pre className="m-0 p-2 text-[12px] whitespace-pre-wrap break-words max-h-[240px] overflow-auto">
        {parts.map((p, i) => {
          const cls = p.added ? 'bg-emerald-50 text-emerald-800' : p.removed ? 'bg-red-50 text-red-800' : 'bg-transparent text-foreground';
          const prefix = p.added ? '+ ' : p.removed ? '- ' : '  ';
          return <span key={i} className={cls}>{prefix}{p.value}</span>;
        })}
      </pre>
    </div>
  );
}
