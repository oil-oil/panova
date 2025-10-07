"use client";

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { genId } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";

// Unified document type for the document library
export type Doc = {
  id: string;
  title: string;
  content: string; // HTML from TiptapEditor
};

// Local storage keys (fresh; no legacy migration)
const STORAGE_KEY_LIST = "panova.docs.v1";
const STORAGE_KEY_SELECTED = "panova.selectedDocId.v1";

// In-memory list, Supabase-backed
export const docsAtom = atom<Doc[]>([]);
export const selectedDocIdAtom = atomWithStorage<string | null>(STORAGE_KEY_SELECTED, null);
export const editingDocIdAtom = atom<string | null>(null);

export const selectedDocAtom = atom((get) => {
  const id = get(selectedDocIdAtom);
  const list = get(docsAtom);
  return id ? list.find((d) => d.id === id) ?? null : null;
});

// ---------------- Supabase repository ----------------
function loadLocalDocs(): Doc[] {
  if (typeof window === 'undefined') return [];
  try { const raw = window.localStorage.getItem(STORAGE_KEY_LIST); return raw ? (JSON.parse(raw) as Doc[]) : []; } catch { return []; }
}
function saveLocalDocs(list: Doc[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(list)); } catch {}
}
async function repoLoadDocs(): Promise<Doc[]> {
  type Row = { id: string; title: string | null; content: string | null };
  try {
    const { data, error } = await supabase
      .from("docs")
      .select("id,title,content")
      .order("id", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    return rows.map((r) => ({ id: String(r.id), title: r.title || "", content: r.content || "" }));
  } catch {
    // Fallback to local storage
    return loadLocalDocs();
  }
}
async function repoInsertDoc(doc: Doc) {
  const { error } = await supabase.from("docs").insert({ id: doc.id, title: doc.title, content: doc.content });
  if (error) throw error;
}
async function repoCreateDoc(title: string): Promise<Doc> {
  const id = genId("doc");
  const doc: Doc = { id, title, content: "" };
  await repoInsertDoc(doc);
  return doc;
}
async function repoUpdateDocTitle(id: string, title: string) {
  const { error } = await supabase.from("docs").update({ title }).eq("id", id);
  if (error) throw error;
}
async function repoUpdateDocContent(id: string, content: string) {
  const { error } = await supabase.from("docs").update({ content }).eq("id", id);
  if (error) throw error;
}
async function repoDeleteDoc(id: string) {
  const { error } = await supabase.from("docs").delete().eq("id", id);
  if (error) throw error;
}

// Debounced content save per doc
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleSaveContent(id: string, content: string) {
  const t = saveTimers.get(id);
  if (t) clearTimeout(t);
  const h = setTimeout(() => { repoUpdateDocContent(id, content).catch(() => {}); }, 220);
  saveTimers.set(id, h);
}

// Public atoms
export const loadDocsAtom = atom(null, async (_get, set) => {
  let rows: Doc[] = [];
  try { rows = await repoLoadDocs(); } catch { rows = []; }
  if (!rows || rows.length === 0) rows = loadLocalDocs();
  set(docsAtom, rows);
  // keep local snapshot in sync for offline fallback
  try { saveLocalDocs(rows); } catch {}
});

export const addDocAtom = atom(null, async (get, set, title?: string) => {
  const list = get(docsAtom);
  const name = (title || "").trim() || `新文档${list.length + 1}`;
  let doc: Doc = { id: genId("doc"), title: name, content: "" };
  try { doc = await repoCreateDoc(name); } catch {}
  const next = [...list, doc];
  set(docsAtom, next);
  try { saveLocalDocs(next); } catch {}
  set(selectedDocIdAtom, doc.id);
  set(editingDocIdAtom, doc.id);
});

export const selectDocAtom = atom(null, (_get, set, id: string) => {
  set(selectedDocIdAtom, id);
});

export const updateDocTitleAtom = atom(null, async (get, set, payload: { id: string; title: string }) => {
  const list = [...get(docsAtom)];
  const it = list.find((d) => d.id === payload.id);
  if (!it) return;
  it.title = payload.title;
  set(docsAtom, list);
  try { saveLocalDocs(list); } catch {}
  try { await repoUpdateDocTitle(payload.id, payload.title); } catch {}
});

export const updateDocContentAtom = atom(null, (get, set, payload: { id: string; content: string }) => {
  const list = [...get(docsAtom)];
  const it = list.find((d) => d.id === payload.id);
  if (!it) return;
  it.content = payload.content;
  set(docsAtom, list);
  try { saveLocalDocs(list); } catch {}
  scheduleSaveContent(payload.id, payload.content);
});

export const deleteDocAtom = atom(null, async (get, set, id: string) => {
  const list = [...get(docsAtom)];
  const idx = list.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const next = list.filter((d) => d.id !== id);
  set(docsAtom, next);
  try { saveLocalDocs(next); } catch {}
  const cur = get(selectedDocIdAtom);
  if (cur === id) {
    const fallback = next[idx] || next[idx - 1] || null;
    set(selectedDocIdAtom, fallback ? fallback.id : null);
  }
  set(editingDocIdAtom, null);
  try { await repoDeleteDoc(id); } catch {}
});

// Create with explicit id/title/content (HTML) and return id; suitable for AI proposals landing
export const createDocExactAtom = atom(null, async (get, set, payload: { id?: string; title?: string; content_html?: string; select?: boolean }) => {
  const id = (payload.id && String(payload.id)) || genId('doc');
  const title = (payload.title || '').trim() || '未命名';
  const content = payload.content_html || '';
  // Update local state first for即时反馈
  const list = [...get(docsAtom), { id, title, content }];
  set(docsAtom, list);
  if (payload.select) set(selectedDocIdAtom, id);
  try {
    await supabase.from('docs').insert({ id, title, content });
  } catch {}
  return id;
});
