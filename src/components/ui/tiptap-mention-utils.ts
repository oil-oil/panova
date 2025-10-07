"use client";

// Small helpers to compute '@' mention range and insert a doc mention chip into TipTap.

export type MentionRange = { has: boolean; query: string; from: number; to: number };

type EditorLike = {
  state: {
    selection: { from: number; to: number; $from: { pos: number } };
    doc: { textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string; content: { size: number } };
  };
  view: { dispatch: (tr: unknown) => void };
  chain: () => { focus: () => { setTextSelection: (sel: { from: number; to: number }) => { run: () => void } } };
  commands: { insertDocMention?: (p: { id: string; label: string }) => unknown; insertProdMention?: (p: { id: string; label: string }) => unknown; insertContent: (html: string) => void; insertText: (t: string) => void };
  getHTML?: () => string;
};

// Scan backward from current selection to find an '@' and build the query text.
export function computeMentionRange(editor: EditorLike | null): MentionRange {
  if (!editor) return { has: false, query: '', from: 0, to: 0 };
  const { from } = editor.state.selection;
  const maxBack = 80; let i = from; let seenAt = -1; let steps = 0;
  while (i > 0 && steps < maxBack) {
    const ch = editor.state.doc.textBetween(i - 1, i, '\n', '\n');
    if (!ch) break;
    if (ch === '@') { seenAt = i - 1; break; }
    if (/\s|[\u3000]/.test(ch)) break; // stop on whitespace
    i--; steps++;
  }
  if (seenAt === -1) return { has: false, query: '', from: 0, to: 0 };
  const query = editor.state.doc.textBetween(seenAt + 1, from, '\n', '\n');
  return { has: true, query, from: seenAt, to: from };
}

// Try to insert as a schema node via the custom command; fallback to HTML insertion.
export function insertDocMentionChip(editor: EditorLike | null, item: { id: string; label: string }, range?: { from: number; to: number }): boolean {
  if (!editor) return false;
  const before = typeof editor.getHTML === 'function' ? editor.getHTML() : '';
  const r = range || computeMentionRange(editor);
  const from = r.has !== false && typeof r.from === 'number' ? r.from : editor.state.selection.from;
  const to = r.has !== false && typeof r.to === 'number' ? r.to : editor.state.selection.to;

  // Apply selection first, then invoke the custom command provided by the extension
  try { editor.chain().focus().setTextSelection({ from, to }).run(); } catch {}

  let ok = false;
  try { ok = !!editor.commands.insertDocMention?.({ id: item.id, label: item.label || '' }); } catch { ok = false; }

  if (!ok) {
    // Fallback to HTML insertion which our extension can parse back via parseHTML
    try {
      const lab = String(item.label || '');
      const html = `<span data-doc-mention="1" data-id="${item.id}" data-label="${lab.replace(/"/g,'&quot;')}">@${lab}</span>`;
      editor.commands.insertContent(html);
      ok = true;
    } catch { ok = false; }
  }

  // Add a trailing space to continue typing naturally
  try { editor.commands.insertText(' '); } catch {}

  // Best-effort cleanup: if selection now sits right after the chip+space, and there is a stray '@'
  // or a duplicate plain label immediately after, remove it. This avoids cases where the original
  // '@query' text wasn't fully replaced due to a stale selection.
  try {
    const { state, view } = editor;
    const pos = state.selection.$from.pos;
    const maxLen = Math.max(1, Math.min((item.label || '').length + 2, 128));
    const raw = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + maxLen), '\n', '\n');
    if (raw && raw.length) {
      // skip any whitespace first
      const m = raw.match(/^(\s*)(.*)$/);
      const ws = m ? (m[1] || '') : '';
      const rest = m ? (m[2] || '') : raw;
      if (rest.startsWith('@')) {
        const tr = (state as unknown as { tr: { delete: (from: number, to: number) => unknown } }).tr.delete(pos, pos + ws.length + 1);
        view.dispatch(tr);
      } else if (item.label && rest.startsWith(item.label)) {
        const tr = (state as unknown as { tr: { delete: (from: number, to: number) => unknown } }).tr.delete(pos, pos + ws.length + item.label.length);
        view.dispatch(tr);
      }
    }
  } catch {}

  const after = typeof editor.getHTML === 'function' ? editor.getHTML() : '';
  return ok && /data-doc-mention/.test(after || '') && after !== before;
}

export function insertProdMentionChip(editor: EditorLike | null, item: { id: string; label: string }, range?: { from: number; to: number }): boolean {
  if (!editor) return false;
  const r = range || computeMentionRange(editor);
  const from = r.has !== false && typeof r.from === 'number' ? r.from : editor.state.selection.from;
  const to = r.has !== false && typeof r.to === 'number' ? r.to : editor.state.selection.to;
  try { editor.chain().focus().setTextSelection({ from, to }).run(); } catch {}
  let ok = false;
  try { ok = !!editor.commands.insertProdMention?.({ id: item.id, label: item.label || '' }); } catch { ok = false; }
  if (!ok) {
    try { const lab = String(item.label || ''); const html = `<span data-prod-mention="1" data-id="${item.id}" data-label="${lab.replace(/"/g,'&quot;')}">@${lab}</span>`; editor.commands.insertContent(html); ok = true; } catch { ok = false; }
  }
  try { editor.commands.insertText(' '); } catch {}
  return ok;
}
