// Minimal SEARCH/REPLACE block patch applier for Markdown-like text.
// Format supports multiple blocks:
// <<<<<<< SEARCH\n
// ...search...\n
// =======\n
// ...replace...\n
// >>>>>>> REPLACE

export function applyDocSearchReplacePatch(source: string, patch: string): string {
  const blocks = splitBlocks(patch);
  if (blocks.length === 0) return source;
  let out = source;
  for (const b of blocks) {
    const search = b.search;
    const replace = b.replace;
    const idx = out.indexOf(search);
    if (idx < 0) {
      throw new Error(`未找到要替换的片段：${truncate(search, 80)}`);
    }
    out = out.slice(0, idx) + replace + out.slice(idx + search.length);
  }
  return out;
}

function splitBlocks(p: string): { search: string; replace: string }[] {
  const text = String(p || '');
  const blocks: { search: string; replace: string }[] = [];
  const re = /<<<<<<<\s*SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const search = normalizeEOL(m[1] || '');
    const replace = normalizeEOL(m[2] || '');
    blocks.push({ search, replace });
  }
  return blocks;
}

function normalizeEOL(s: string): string { return s.replace(/\r\n/g, '\n'); }
function truncate(s: string, n: number): string { const t = String(s || ''); return t.length > n ? t.slice(0, n) + '…' : t; }

