"use client";

import { atom, type Atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { clamp, genId } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import type { FeatureNode, FeatureStatus, Product } from "@/types/feature-tree";

// Storage keys (legacy localStorage, kept for migration & selection persistence)
const LEGACY_FEATURES_KEY = "panova.features.v1"; // old: single product
const PRODUCTS_KEY_LEGACY = "panova.products.v1";       // [{ id, name }]
const SELECTED_PRODUCT_KEY = "panova.selectedProductId.v1";
const FEATURES_BY_PRODUCT_KEY = "panova.featuresByProduct.v1"; // { [productId]: FeatureNode[] }

// Initial demo data (keep empty to avoid polluting real projects)
const initialNodes: FeatureNode[] = [];

// ---------------- Multi‑product support ----------------
// Product type moved to @/types/feature-tree

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

// Provide stable default product id to avoid re‑gen on each boot
const DEFAULT_PRODUCT_ID = "prod_default";

// Supabase-backed now; no local product storage except for selection

function getInitialSelectedProduct(): string {
  if (typeof window === "undefined") return DEFAULT_PRODUCT_ID;
  const raw = window.localStorage.getItem(SELECTED_PRODUCT_KEY);
  if (raw && typeof raw === "string") {
    try { const v = JSON.parse(raw); if (typeof v === "string" && v) return v; } catch {}
  }
  return DEFAULT_PRODUCT_ID;
}

// Core atoms for products and product‑scoped features (Supabase backed)
export const productsAtom = atom<Product[]>([]);
export const selectedProductIdAtom = atomWithStorage<string>(SELECTED_PRODUCT_KEY, getInitialSelectedProduct());

// Derived helpers
export const currentProductAtom = atom((get) => {
  const pid = get(selectedProductIdAtom);
  const list = get(productsAtom);
  return list.find((p) => p.id === pid) ?? list[0] ?? { id: DEFAULT_PRODUCT_ID, name: "默认产品" };
});

export const nodesAtom = atom<FeatureNode[]>([]);

// ---- Supabase repository helpers ----
async function repoLoadProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("id,name").order("name", { ascending: true });
  if (error) throw error; return (data ?? []) as Product[];
}
async function repoInsertProduct(id: string, name: string) {
  const { error } = await supabase.from("products").insert({ id, name }); if (error) throw error;
}
async function repoRenameProduct(id: string, name: string) {
  const { error } = await supabase.from("products").update({ name }).eq("id", id); if (error) throw error;
}
async function repoDeleteProduct(id: string) {
  await supabase.from("feature_nodes").delete().eq("product_id", id);
  const { error } = await supabase.from("products").delete().eq("id", id); if (error) throw error;
}
async function repoLoadNodes(productId: string): Promise<FeatureNode[]> {
  type Row = { id: string; title: string | null; parent_id: string | null; order: number | null; collapsed: boolean | null; status: FeatureStatus | null; description: string | null };
  const { data, error } = await supabase
    .from("feature_nodes")
    .select("id,title,parent_id,order,collapsed,status,description")
    .eq("product_id", productId)
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("order", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    title: r.title || "",
    parentId: r.parent_id ?? null,
    order: r.order ?? 0,
    collapsed: !!r.collapsed,
    status: (r.status || "pending") as FeatureStatus,
    description: r.description || "",
  }));
}
async function repoSaveAllNodes(productId: string, nodes: FeatureNode[]) {
  if (!productId) return;
  const payload = nodes.map((n) => ({ id: n.id, product_id: productId, title: n.title, parent_id: n.parentId, order: n.order, collapsed: !!n.collapsed, status: n.status, description: n.description }));
  const { error: upErr } = await supabase.from("feature_nodes").upsert(payload, { onConflict: "id" }); if (upErr) throw upErr;
  const { data: rows, error: qErr } = await supabase.from("feature_nodes").select("id").eq("product_id", productId);
  if (qErr) throw qErr;
  const keep = new Set(nodes.map((n) => n.id));
  const toDelete = (rows ?? []).map((r: { id: string|number }) => String(r.id)).filter((id: string) => !keep.has(id));
  if (toDelete.length) await supabase.from("feature_nodes").delete().in("id", toDelete);
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(productId: string, nodes: FeatureNode[]) {
  try { if (saveTimer) clearTimeout(saveTimer); } catch {}
  saveTimer = setTimeout(() => { repoSaveAllNodes(productId, nodes).catch(() => {}); }, 180);
}

// One-shot migration from legacy localStorage to Supabase
async function migrateLegacyToSupabaseIfNeeded() {
  if (typeof window === "undefined") return;
  try {
    const mark = window.localStorage.getItem("panova.migrated.supabase.v1");
    if (mark) return;
    const { data: prodRows } = await supabase.from("products").select("id").limit(1);
    if (prodRows && prodRows.length) { window.localStorage.setItem("panova.migrated.supabase.v1", "1"); return; }
    const legacyProducts = safeParse<Product[]>(window.localStorage.getItem(PRODUCTS_KEY_LEGACY));
    const legacyMap = safeParse<Record<string, FeatureNode[]>>(window.localStorage.getItem(FEATURES_BY_PRODUCT_KEY));
    const legacySingle = safeParse<FeatureNode[]>(window.localStorage.getItem(LEGACY_FEATURES_KEY));
    const prods: Product[] = (Array.isArray(legacyProducts) && legacyProducts.length) ? legacyProducts! : [{ id: DEFAULT_PRODUCT_ID, name: "默认产品" }];
    for (const p of prods) {
      await repoInsertProduct(p.id, p.name);
      const list = legacyMap?.[p.id] ?? (p.id === DEFAULT_PRODUCT_ID ? (legacySingle ?? initialNodes) : initialNodes);
      await repoSaveAllNodes(p.id, Array.isArray(list) ? list : initialNodes);
    }
    window.localStorage.setItem("panova.migrated.supabase.v1", "1");
  } catch {}
}

export const loadProductsAtom = atom(null, async (_get, set) => {
  await migrateLegacyToSupabaseIfNeeded();
  let list: Product[] = [];
  try { list = await repoLoadProducts(); } catch {}
  if (!list.length) {
    const id = DEFAULT_PRODUCT_ID, name = "默认产品";
    try { await repoInsertProduct(id, name); await repoSaveAllNodes(id, initialNodes); } catch {}
    set(productsAtom, [{ id, name }]);
  } else {
    set(productsAtom, list);
  }
});
export const loadNodesForCurrentProductAtom = atom(null, async (get, set) => {
  const pid = get(selectedProductIdAtom);
  if (!pid) return; const rows = await repoLoadNodes(pid);
  set(nodesAtom, rows);
  set(historyPastAtom, []); set(historyFutureAtom, []);
});

// ---- History (Undo/Redo) ----
export const historyPastAtom = atom<FeatureNode[][]>([]);
export const historyFutureAtom = atom<FeatureNode[][]>([]);
export const isTimeTravelingAtom = atom(false);

function snapshot(nodes: FeatureNode[]): FeatureNode[] {
  // shallow copy is enough (all fields are primitives)
  return nodes.map((n) => ({ ...n }));
}

function pushHistory(get: unknown, set: unknown) {
  const _get = get as <T>(an: Atom<T>) => T;
  const _set = set as <T>(an: Atom<T>, v: T) => void;
  if (_get(isTimeTravelingAtom)) return;
  const past = _get(historyPastAtom);
  const nodes = _get(nodesAtom);
  _set(historyPastAtom, [...past, snapshot(nodes as FeatureNode[])]);
  _set(historyFutureAtom, []);
}

export const undoAtom = atom(null, (get, set) => {
  const past = get(historyPastAtom);
  if (past.length === 0) return;
  const current = get(nodesAtom);
  const prev = past[past.length - 1];
  set(isTimeTravelingAtom, true);
  set(historyPastAtom, past.slice(0, -1));
  set(historyFutureAtom, [...get(historyFutureAtom), snapshot(current)]);
  set(nodesAtom, prev);
  set(isTimeTravelingAtom, false);
});

export const redoAtom = atom(null, (get, set) => {
  const future = get(historyFutureAtom);
  if (future.length === 0) return;
  const current = get(nodesAtom);
  const next = future[future.length - 1];
  set(isTimeTravelingAtom, true);
  set(historyFutureAtom, future.slice(0, -1));
  set(historyPastAtom, [...get(historyPastAtom), snapshot(current)]);
  set(nodesAtom, next);
  set(isTimeTravelingAtom, false);
});

// Clear history (useful when switching product)
export const clearHistoryAtom = atom(null, (_get, set) => {
  set(historyPastAtom, []);
  set(historyFutureAtom, []);
});

// Replace entire node set (used by Markdown import)
export const replaceAllNodesAtom = atom(null, (get, set, list: FeatureNode[]) => {
  const pid = get(selectedProductIdAtom);
  set(nodesAtom, Array.isArray(list) ? list : []);
  set(historyPastAtom, []);
  set(historyFutureAtom, []);
  scheduleSave(pid, Array.isArray(list) ? list : []);
});

// Product management actions
export const addProductAtom = atom(null, async (get, set, name: string | undefined) => {
  const list = get(productsAtom);
  const id = genId("prod");
  const title = (name || "").trim() || `新产品${list.length + 1}`;
  try { await repoInsertProduct(id, title); await repoSaveAllNodes(id, []); } catch {}
  set(productsAtom, [...list, { id, name: title }]);
  set(selectedProductIdAtom, id);
  set(nodesAtom, []);
  set(historyPastAtom, []); set(historyFutureAtom, []);
});

export const renameProductAtom = atom(null, async (get, set, payload: { id: string; name: string }) => {
  try { await repoRenameProduct(payload.id, payload.name); } catch {}
  const list = get(productsAtom);
  const next = list.map((p) => (p.id === payload.id ? { ...p, name: payload.name } : p));
  set(productsAtom, next);
});

export const deleteProductAtom = atom(null, async (get, set, id: string) => {
  const list = get(productsAtom);
  if (list.length <= 1) return;
  try { await repoDeleteProduct(id); } catch {}
  const nextList = list.filter((p) => p.id !== id);
  const cur = get(selectedProductIdAtom);
  set(productsAtom, nextList);
  if (cur === id) {
    const fallback = nextList[0]?.id ?? DEFAULT_PRODUCT_ID;
    set(selectedProductIdAtom, fallback);
    try { const rows = await repoLoadNodes(fallback); set(nodesAtom, rows); } catch { set(nodesAtom, []); }
  }
  set(historyPastAtom, []); set(historyFutureAtom, []);
});

export const selectProductAtom = atom(null, async (_get, set, id: string) => {
  set(selectedProductIdAtom, id);
  try { const rows = await repoLoadNodes(id); set(nodesAtom, rows); } catch { set(nodesAtom, []); }
  set(historyPastAtom, []); set(historyFutureAtom, []);
});

// Create product with explicit id/name (used by AI提议落地等精确场景)
export const createProductExactAtom = atom(
  null,
  async (get, set, payload: { id?: string; name?: string; select?: boolean }) => {
    const list = get(productsAtom);
    const id = (payload.id && String(payload.id)) || genId("prod");
    const name = (payload.name || "").trim() || `新产品${list.length + 1}`;
    try { await repoInsertProduct(id, name); await repoSaveAllNodes(id, []); } catch {}
    set(productsAtom, [...list, { id, name }]);
    if (payload.select) {
      set(selectedProductIdAtom, id);
      try { const rows = await repoLoadNodes(id); set(nodesAtom, rows); } catch { set(nodesAtom, []); }
      set(historyPastAtom, []); set(historyFutureAtom, []);
    }
    return id;
  },
);

// Helpers
export function getSiblings(nodes: FeatureNode[], parentId: string | null) {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

export function getChildren(nodes: FeatureNode[], id: string) {
  return getSiblings(nodes, id);
}

export function getDescendantIds(nodes: FeatureNode[], id: string): string[] {
  const out: string[] = [];
  const visit = (pid: string) => {
    for (const child of getChildren(nodes, pid)) {
      out.push(child.id);
      visit(child.id);
    }
  };
  visit(id);
  return out;
}

export function getAncestorIds(nodes: FeatureNode[], id: string): string[] {
  const map = new Map(nodes.map((n) => [n.id, n] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = map.get(id);
  let guard = 0;
  while (cur && cur.parentId) {
    // break on cycles or missing links
    if (seen.has(cur.parentId)) break;
    seen.add(cur.parentId);
    out.push(cur.parentId);
    cur = map.get(cur.parentId);
    guard++;
    if (guard > nodes.length + 5) break; // hard guard to avoid infinite loops
  }
  return out;
}

export function reindexSiblings(nodes: FeatureNode[], parentId: string | null) {
  const sibs = getSiblings(nodes, parentId);
  sibs.forEach((n, i) => {
    n.order = i;
  });
}

export type FlattenedItem = {
  id: string;
  title: string;
  depth: number;
  parentId: string | null;
  collapsed?: boolean;
};

export function flattenTree(nodes: FeatureNode[], forceOpen?: Set<string>): FlattenedItem[] {
  const roots = getSiblings(nodes, null);
  const out: FlattenedItem[] = [];
  const walk = (id: string | null, depth: number) => {
    const children = id === null ? roots : getChildren(nodes, id);
    for (const n of children) {
      out.push({ id: n.id, title: n.title, depth, parentId: n.parentId, collapsed: n.collapsed });
      // 当 forceOpen 指定时，即使节点标记为 collapsed，也继续展开其子级
      if (!n.collapsed || (forceOpen && forceOpen.has(n.id))) {
        walk(n.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return out;
}

// Compute projected depth/parent when dragging horizontally
export function getProjection(
  flattened: FlattenedItem[],
  activeId: string,
  overId: string,
  deltaX: number,
  indentW: number,
  nodes: FeatureNode[],
  position: "before" | "after" = "before",
) {
  // Base depth from current active
  const activeIndex = flattened.findIndex((i) => i.id === activeId);
  const active = flattened[activeIndex];
  // Apply horizontal hysteresis to avoid depth jitter when mostly dragging vertically
  // First step requires a larger motion; subsequent steps advance per full indent unit.
  const dir = deltaX >= 0 ? 1 : -1;
  const absX = Math.abs(deltaX);
  const firstThreshold = indentW * (dir > 0 ? 0.6 : 0.4);
  let depthChange = 0;
  if (absX > firstThreshold) {
    depthChange = 1 + Math.floor((absX - firstThreshold) / indentW);
  }
  let newDepth = clamp(active.depth + dir * depthChange, 0, 100);

  // Constrain depth by the target row for before/after positions
  const overItemFull = flattened.find((i) => i.id === overId);
  const overDepth = overItemFull ? overItemFull.depth : 0;
  if (position === "before") {
    newDepth = Math.min(newDepth, overDepth);
  } else if (position === "after") {
    newDepth = Math.min(newDepth, overDepth + 1);
  }

  // Work on a flattened list without the active item
  const flatWo = flattened.filter((i) => i.id !== activeId);
  const overIndexWo = flatWo.findIndex((i) => i.id === overId);
  const insertFlatIndex = overIndexWo + (position === "after" ? 1 : 0);

  // Determine parent at target depth by scanning up from insertFlatIndex-1
  const disallow = new Set([activeId, ...getDescendantIds(nodes, activeId)]);
  let parentId: string | null = null;
  if (newDepth === 0) parentId = null;
  else {
    for (let i = insertFlatIndex - 1; i >= 0; i--) {
      const it = flatWo[i];
      if (it.depth === newDepth - 1 && !disallow.has(it.id)) {
        parentId = it.id;
        break;
      }
      if (it.depth < newDepth - 1) {
        // No suitable parent this high; fallback to null
        parentId = null;
        break;
      }
    }
  }

  if (parentId && disallow.has(parentId)) parentId = null;

  // Compute insertIndex among siblings under parentId by counting previous siblings in flatWo
  const sibs = getSiblings(nodes, parentId);
  // Scan backward from insertFlatIndex-1 to find previous sibling under this parent
  let prevSiblingId: string | null = null;
  for (let i = insertFlatIndex - 1; i >= 0; i--) {
    const it = flatWo[i];
    if (it.parentId === parentId) {
      prevSiblingId = it.id;
      break;
    }
    if (it.depth < newDepth) break; // crossed upper level
  }
  let insertIndex = 0;
  if (prevSiblingId) {
    const idx = sibs.findIndex((s) => s.id === prevSiblingId);
    insertIndex = idx >= 0 ? idx + 1 : sibs.length;
  } else {
    insertIndex = 0;
  }

  return { depth: newDepth, parentId, insertIndex } as const;
}

// UI atoms
export const activeIdAtom = atom<string | null>(null);
export const draggingOffsetXAtom = atom(0);
export const editingIdAtom = atom<string | null>(null);
export const editingDetailIdAtom = atom<string | null>(null);
export const searchQueryAtom = atom("");
export const selectedNodeIdAtom = atom<string | null>(null);
export const overIdAtom = atom<string | null>(null);
export const overRegionAtom = atom<"before" | "inside" | "after" | null>(null);

// Toggle collapsed state
export const toggleCollapseAtom = atom(null, (get, set, id: string) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => (n.id === id ? { ...n, collapsed: !n.collapsed } : n));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Rename node
export const renameNodeAtom = atom(null, (get, set, payload: { id: string; title: string }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => (n.id === payload.id ? { ...n, title: payload.title } : n));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Update node status
export const updateNodeStatusAtom = atom(null, (get, set, payload: { id: string; status: FeatureStatus }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => (n.id === payload.id ? { ...n, status: payload.status } : n));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Update node description
export const updateNodeDescriptionAtom = atom(null, (get, set, payload: { id: string; description: string }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => (n.id === payload.id ? { ...n, description: payload.description } : n));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Update status with parent->children cascade: updating a parent will apply to all descendants; updating a leaf only affects itself.
export const updateNodeStatusCascadeAtom = atom(null, (get, set, payload: { id: string; status: FeatureStatus }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const before = get(nodesAtom);
  const ids = new Set<string>([payload.id, ...getDescendantIds(before, payload.id)]);
  const nodes = before.map((n) => (ids.has(n.id) ? { ...n, status: payload.status } : n));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Add child node
export const addChildAtom = atom(null, (get, set, payload: { parentId: string | null; title?: string }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = [...get(nodesAtom)];
  const id = genId("f");
  const order = getSiblings(nodes, payload.parentId).length;
  nodes.push({ 
    id, 
    title: payload.title ?? "", 
    parentId: payload.parentId ?? null, 
    order,
    status: "pending" as FeatureStatus,
    description: ""
  });
  set(nodesAtom, nodes);
  set(editingIdAtom, id);
  scheduleSave(pid, nodes);
});

// Add node with explicit fields (id optional) and optional insert index/status/description.
export const addExactNodeAtom = atom(null, (get, set, payload: { id?: string; parentId: string | null; title: string; index?: number; status?: FeatureStatus; description?: string }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = [...get(nodesAtom)];
  const newId = payload.id && !nodes.some(n => n.id === payload.id) ? payload.id : genId("f");
  const sibs = getSiblings(nodes, payload.parentId);
  const insertIndex = typeof payload.index === "number" ? clamp(payload.index, 0, sibs.length) : sibs.length;
  // bump orders >= insertIndex
  for (const n of sibs) {
    if (n.order >= insertIndex) n.order += 1;
  }
  const status = payload.status ?? ("pending" as FeatureStatus);
  nodes.push({
    id: newId,
    title: payload.title ?? "",
    parentId: payload.parentId ?? null,
    order: insertIndex,
    status,
    description: payload.description ?? "",
  });
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});

// Add sibling below
export const addSiblingBelowAtom = atom(null, (get, set, payload: { id: string; title?: string }) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = [...get(nodesAtom)];
  const current = nodes.find((n) => n.id === payload.id);
  if (!current) return;
  const sibs = getSiblings(nodes, current.parentId);
  const id = genId("f");
  const insertPos = current.order + 1;
  // bump orders after insert
  for (const n of sibs) {
    if (n.order >= insertPos) n.order += 1;
  }
  nodes.push({ 
    id, 
    title: payload.title ?? "", 
    parentId: current.parentId, 
    order: insertPos,
    status: "pending" as FeatureStatus,
    description: ""
  });
  set(nodesAtom, nodes);
  set(editingIdAtom, id);
  scheduleSave(pid, nodes);
});

// Delete node and its subtree
export const deleteNodeAtom = atom(null, (get, set, id: string) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = [...get(nodesAtom)];
  const target = nodes.find((n) => n.id === id);
  if (!target) return;
  const toDelete = new Set([id, ...getDescendantIds(nodes, id)]);
  const remaining = nodes.filter((n) => !toDelete.has(n.id));
  reindexSiblings(remaining, target.parentId);
  set(nodesAtom, remaining);
  scheduleSave(pid, remaining);
});

// Move item to a new parent and position
export const moveNodeAtom = atom(
  null,
  (
    get,
    set,
    payload: { id: string; newParentId: string | null; newIndex: number },
  ) => {
    pushHistory(get, set);
    const pid = get(selectedProductIdAtom);
    const nodes = [...get(nodesAtom)];
    const node = nodes.find((n) => n.id === payload.id);
    if (!node) return;

    const fromParent = node.parentId;
    const toParent = payload.newParentId;
    const fromSibs = getSiblings(nodes, fromParent);
    const toSibs = getSiblings(nodes, toParent);

    // Remove gap from old siblings
    for (const n of fromSibs) {
      if (n.id !== node.id && n.order > node.order) n.order -= 1;
    }

    // Insert into new siblings at newIndex
    for (const n of toSibs) {
      if (n.order >= payload.newIndex) n.order += 1;
    }

    node.parentId = toParent;
    node.order = clamp(payload.newIndex, 0, getSiblings(nodes, toParent).length);

    set(nodesAtom, nodes);
    scheduleSave(pid, nodes);
  },
);

// Expand/collapse helpers
export const expandAllAtom = atom(null, (get, set) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => ({ ...n, collapsed: false }));
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});
export const collapseAllAtom = atom(null, (get, set) => {
  pushHistory(get, set);
  const pid = get(selectedProductIdAtom);
  const nodes = get(nodesAtom).map((n) => ({ ...n, collapsed: true }));
  // Never collapse roots entirely visually; allow but UX wise fine
  set(nodesAtom, nodes);
  scheduleSave(pid, nodes);
});
