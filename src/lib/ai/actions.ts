// Centralized action constants and types to avoid hard-coded string literals.
// Shared by client and server code.

import type { FeatureStatus } from "@/types/feature-tree";

// Refs
export type NodeRef = { by: "id" | "path"; value: string };
export type DocRef = { by: "id" | "title"; value: string };

// Product-level actions
export const PRODUCT_ACTIONS = {
  PRODUCT_CREATE: "product_create",
  PRODUCT_SELECT: "product_select",
} as const;
export type ProductActionKind = typeof PRODUCT_ACTIONS[keyof typeof PRODUCT_ACTIONS];
export type ProductAction =
  | { action: typeof PRODUCT_ACTIONS.PRODUCT_CREATE; name?: string; id?: string }
  | { action: typeof PRODUCT_ACTIONS.PRODUCT_SELECT; id: string };

// Feature-tree action kinds
export const FEATURE_ACTIONS = {
  ADD: "add",
  ADD_TREE: "add_tree",
  RENAME: "rename",
  SET_DESCRIPTION: "set_description",
  SET_STATUS: "set_status",
  MOVE: "move",
  DELETE: "delete",
} as const;
export type FeatureActionKind = typeof FEATURE_ACTIONS[keyof typeof FEATURE_ACTIONS];

export type AddTreeNode = { id?: string; title: string; status?: FeatureStatus; description?: string; children?: AddTreeNode[] };
export type FeatureAction =
  | { action: typeof FEATURE_ACTIONS.ADD; title: string; parent: NodeRef; index?: number; status?: FeatureStatus; description?: string; id?: string }
  | { action: typeof FEATURE_ACTIONS.ADD_TREE; parent: NodeRef; nodes: AddTreeNode[]; index?: number }
  | { action: typeof FEATURE_ACTIONS.RENAME; target: NodeRef; title: string }
  | { action: typeof FEATURE_ACTIONS.SET_DESCRIPTION; target: NodeRef; description: string }
  | { action: typeof FEATURE_ACTIONS.SET_STATUS; target: NodeRef; status: FeatureStatus }
  | { action: typeof FEATURE_ACTIONS.MOVE; target: NodeRef; parent: NodeRef; index?: number }
  | { action: typeof FEATURE_ACTIONS.DELETE; target: NodeRef };

// 文档动作类型（Doc action kinds）
export const DOC_ACTIONS = {
  DOC_CREATE: "doc_create",
  DOC_RENAME: "doc_rename",
  DOC_SET_CONTENT: "doc_set_content",
  DOC_DELETE: "doc_delete",
  DOC_PATCH: "doc_patch", // 局部修改（基于补丁），仅提议，需确认后落地
} as const;
export type DocActionKind = typeof DOC_ACTIONS[keyof typeof DOC_ACTIONS];

export type DocAction =
  | { action: typeof DOC_ACTIONS.DOC_CREATE; title: string; content_md?: string; id?: string }
  | { action: typeof DOC_ACTIONS.DOC_RENAME; target: DocRef; title: string }
  | { action: typeof DOC_ACTIONS.DOC_SET_CONTENT; target: DocRef; content_md: string }
  | { action: typeof DOC_ACTIONS.DOC_DELETE; target: DocRef }
  | { action: typeof DOC_ACTIONS.DOC_PATCH; target: DocRef; format?: 'search_replace'|'udiff'; patch: string };

// Envelope schema for assistant output
export type UnifiedAction = FeatureAction | DocAction | ProductAction;
// Back-compat: doc_actions remains optional; clients should merge it into actions.
export type Envelope = { answer_md?: string; actions?: UnifiedAction[]; doc_actions?: DocAction[] };

// Display meta for feature status (centralized labels & classes)
export const FEATURE_STATUS_META: Record<FeatureStatus, { label: string; cls: string }> = {
  implemented: { label: "已实现", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  developing: { label: "开发中", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  pending: { label: "待开发", cls: "bg-sky-100 text-sky-800 border-sky-200" },
};
