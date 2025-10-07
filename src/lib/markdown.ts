// Shared Markdown/HTML helpers

export function markdownToHtml(md: string): string {
  let s = md || "";
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/```([\s\S]*?)```/g, (_m, p1) => `<pre class=\"rounded bg-black/85 text-white p-2 overflow-auto\"><code>${String(p1).replace(/\n/g, "<br/>")}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, (_m, p1) => `<code class=\"bg-muted px-1 rounded\">${p1}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Encode href to avoid breaking attributes; allow only http/https/mailto
  s = s.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (_m, text, href) => {
    try {
      const u = String(href || '').trim();
      const safe = u.startsWith('http://') || u.startsWith('https://') || u.startsWith('mailto:') ? encodeURI(u) : '#';
      return `<a href=\"${safe}\" target=\"_blank\" rel=\"noreferrer\" class=\"underline\">${text}<\/a>`;
    } catch { return text; }
  });
  s = s.replace(/^######\s(.+)$/gm, '<h6>$1<\/h6>')
       .replace(/^#####\s(.+)$/gm, '<h5>$1<\/h5>')
       .replace(/^####\s(.+)$/gm, '<h4>$1<\/h4>')
       .replace(/^###\s(.+)$/gm, '<h3>$1<\/h3>')
       .replace(/^##\s(.+)$/gm, '<h2>$1<\/h2>')
       .replace(/^#\s(.+)$/gm, '<h1>$1<\/h1>');
  const lines = s.split(/\n/); const out: string[] = []; let inList = false;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) { if (!inList) { out.push('<ul class=\"list-disc pl-5\">'); inList = true; } out.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`); }
    else { if (inList) { out.push('</ul>'); inList = false; } out.push(line); }
  }
  if (inList) out.push('</ul>'); s = out.join('\n');
  s = s.replace(/\n{2,}/g, '</p><p>').replace(/^(?!<h\d|<ul|<pre|<p|<\/ul|<\/pre)(.+)$/gm, '<p>$1</p>');
  return s;
}

export function htmlToMarkdownLite(html: string): string {
  if (!html) return "";
  // Convert custom doc-mention spans to a stable token: @[label](doc://id)
  let withMentions = (html || '').replace(/<span[^>]*data-doc-mention[^>]*>([\s\S]*?)<\/span>/gi, (m) => {
    const id = (m.match(/data-id\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const label = (m.match(/data-label\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const safeLabel = label.replace(/\]/g, ')');
    return id ? `@[${safeLabel}](doc://${id})` : `@${safeLabel}`;
  });
  // Convert product mention spans to token: @[label](prod://id)
  withMentions = withMentions.replace(/<span[^>]*data-prod-mention[^>]*>([\s\S]*?)<\/span>/gi, (m) => {
    const id = (m.match(/data-id\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const label = (m.match(/data-label\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const safeLabel = label.replace(/\]/g, ')');
    return id ? `@[${safeLabel}](prod://${id})` : `@${safeLabel}`;
  });
  // Deduplicate patterns like: @[label](doc://id)<space>label -> keep only the token
  // Also tolerate no space between them
  withMentions = withMentions.replace(/@\[(.+?)\]\(doc:\/\/[^\)]+\)\s*\1(\b)?/g, (_m: string, _label: string) => {
    // Keep only the token portion and drop the duplicated trailing plain label
    const cut = _m.lastIndexOf(_label);
    if (cut > -1) return _m.slice(0, cut).replace(/\s+$/, '');
    return _m;
  });
  // Remove a stray '@' that immediately follows a token (rare selection glitches)
  withMentions = withMentions.replace(/(@\[[^\]]+\]\((?:doc|prod):\/\/[^\)]+\))\s*@/g, '$1 ');
  return withMentions
    .replace(/<br\s*\/?>(\n)?/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, '```$1```')
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Convert tiptap-like HTML to markdown, with table support to pipe-table syntax
export function htmlToMarkdownWithTable(html: string): string {
  const toText = (frag: string) => {
    return frag
      .replace(/<br\s*\/?>(\n)?/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const matches = [...(html || '').matchAll(tableRegex)];
  if (!matches.length) return toText(html || '');

  let out = '';
  let lastIndex = 0;
  for (const m of matches) {
    const idx = m.index || 0;
    const before = (html || '').slice(lastIndex, idx);
    if (before.trim()) out += toText(before) + '\n\n';
    out += tableToPipeMarkdown(String(m[0])) + '\n\n';
    lastIndex = idx + String(m[0]).length;
  }
  const after = (html || '').slice(lastIndex);
  if (after.trim()) out += toText(after);
  return out.trim();
}

function tableToPipeMarkdown(tableHtml: string) {
  const c = globalThis.document ? document.createElement('div') : null;
  if (!c) return '';
  c.innerHTML = tableHtml;
  const table = c.querySelector('table');
  if (!table) return '';
  const getCells = (row: Element, sel: string) => Array.from(row.querySelectorAll(sel)).map((el) => cellText(el as HTMLElement));
  const cellText = (el: HTMLElement) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const rows: string[][] = [];
  const thead = table.querySelector('thead');
  if (thead) {
    const thr = thead.querySelectorAll('tr');
    if (thr.length) rows.push(getCells(thr[0], 'th,td'));
  }
  const bodyRows = table.querySelectorAll('tbody tr, tr');
  bodyRows.forEach((tr) => rows.push(getCells(tr, 'td,th')));
  if (rows.length === 0) return '';
  let header = rows[0];
  let start = 1;
  if (!thead && !table.querySelector('th')) {
    header = rows[0];
    start = 1;
  }
  const colCount = Math.max(...rows.map((r) => r.length));
  const pad = (arr: string[]) => { const a = arr.slice(); while (a.length < colCount) a.push(''); return a; };
  const lines: string[] = [];
  lines.push('| ' + pad(header).join(' | ') + ' |');
  lines.push('| ' + new Array(colCount).fill('---').join(' | ') + ' |');
  for (let i = start; i < rows.length; i++) lines.push('| ' + pad(rows[i]).join(' | ') + ' |');
  return lines.join('\n');
}

export function stripHtml(html: string): string { return (html || '').replace(/<[^>]*>/g, ''); }
