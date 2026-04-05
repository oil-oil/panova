const RAW = `__REPORT_CONTENT__`;

// --- Icons ---
const ICONS = {
  create: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/></svg>',
  impact: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M10 5l3 3-3 3"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>',
};

// --- Escape helpers ---
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// --- Block parser ---
function parseBlocks(src) {
  const lines = src.split('\n');
  const segments = [];
  let current = { type: 'md', lines: [] };
  for (const line of lines) {
    const openMatch = line.match(/^:::(\w+)\s*$/);
    const closeMatch = line.match(/^:::\s*$/);
    if (openMatch && current.type === 'md') {
      if (current.lines.length) segments.push({ ...current, text: current.lines.join('\n') });
      current = { type: openMatch[1], lines: [] };
    } else if (closeMatch && current.type !== 'md') {
      segments.push({ ...current, text: current.lines.join('\n') });
      current = { type: 'md', lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length) segments.push({ ...current, text: current.lines.join('\n') });
  return segments;
}

// --- markdown-it setup ---
const md = markdownit({ html: true, linkify: true, typographer: true });

// Inline tooltip: [term](tip:explanation)
let _inTipLink = false;
const _origLinkOpen = md.renderer.rules.link_open || null;
md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
  const hrefIdx = tokens[idx].attrIndex('href');
  if (hrefIdx >= 0) {
    const href = tokens[idx].attrs[hrefIdx][1];
    if (href.startsWith('tip:')) {
      _inTipLink = true;
      return '<span class="tip-word" data-tip="' + escAttr(decodeURIComponent(href.slice(4))) + '">';
    }
    if (href.startsWith('#')) {
      if (!tokens[idx].attrGet('class')) tokens[idx].attrSet('class', 'concept-link');
    }
  }
  _inTipLink = false;
  return _origLinkOpen ? _origLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_close = function(tokens, idx, options, env, self) {
  if (_inTipLink) { _inTipLink = false; return '</span>'; }
  return self.renderToken(tokens, idx, options);
};

// --- Concept card post-processing ---
function postProcessConceptCards(html) {
  html = html.replace(
    /<p><strong>怎么产生[：:]\s*<\/strong>\s*([\s\S]*?)<\/p>/g,
    '<div class="concept-attr"><div class="concept-attr-icon">' + ICONS.create + '</div><div class="concept-attr-body"><strong>怎么产生</strong><p>$1</p></div></div>'
  );
  html = html.replace(
    /<p><strong>影响范围[：:]\s*<\/strong>\s*([\s\S]*?)<\/p>/g,
    '<div class="concept-attr"><div class="concept-attr-icon">' + ICONS.impact + '</div><div class="concept-attr-body"><strong>影响范围</strong><p>$1</p></div></div>'
  );
  return html;
}

// --- Mindmap ---
function parseMindmapTree(text) {
  const lines = text.split('\n').filter(l => /^\s*-/.test(l));
  const root = [];
  const stack = [{ level: -1, node: { children: root } }];
  for (const line of lines) {
    const indent = line.search(/\S/);
    const level = Math.floor(indent / 2);
    const nodeText = line.trim().replace(/^-\s*/, '');
    const node = { text: nodeText, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ level, node });
  }
  return root;
}

function renderMindmapNode(node, depth) {
  const hasChildren = node.children.length > 0;
  const toggle = hasChildren ? '<span class="mm-toggle">\u25BE</span>' : '';
  const clickAttr = hasChildren ? ' onclick="toggleMM(this)"' : '';
  let html = '<div class="mm-node mm-l' + depth + '">';
  html += '<div class="mm-label' + (hasChildren ? ' mm-expandable' : '') + '"' + clickAttr + '>' + toggle + escHtml(node.text) + '</div>';
  if (hasChildren) {
    html += '<div class="mm-children">';
    node.children.forEach(c => { html += renderMindmapNode(c, depth + 1); });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderMindmap(text) {
  const nodes = parseMindmapTree(text);
  let html = '<div class="block-mindmap-tree">';
  nodes.forEach(n => { html += renderMindmapNode(n, 0); });
  html += '</div>';
  return html;
}

function toggleMM(label) {
  label.closest('.mm-node').classList.toggle('mm-collapsed');
}

// --- Flow diagrams ---
function renderMermaid(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const hasArrow = lines.some(l => l.includes('\u2192'));
  const hasDecision = lines.some(l => l.startsWith('? ') || l.startsWith('> '));
  if (hasArrow && !hasDecision) return renderFlowChain(lines);
  return renderFlowSteps(lines);
}

function renderFlowChain(lines) {
  const parts = lines.join(' ').split(/\s*\u2192\s*/);
  let html = '<div class="flow-chain">';
  parts.forEach((p, i) => {
    if (!p.trim()) return;
    const isBack = p.startsWith('\u21BA');
    const label = isBack ? p.replace(/^\u21BA\s*/, '').trim() : p.trim();
    html += '<div class="flow-chip' + (isBack ? ' flow-chip-back' : '') + '">' + escHtml(isBack ? '\u21BA ' + label : label) + '</div>';
    if (i < parts.length - 1 && !isBack) html += '<span class="flow-sep">\u2192</span>';
  });
  html += '</div>';
  return html;
}

function renderFlowSteps(lines) {
  let html = '<div class="flow-steps">';
  let needConn = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }
    if (line.startsWith('? ')) {
      if (needConn) html += '<div class="flow-vconn">\u2193</div>';
      html += '<div class="flow-decision"><span class="flow-dec-icon">\u25C6</span>' + escHtml(line.slice(2).trim()) + '</div>';
      i++;
      const branches = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        const m = lines[i].slice(2).match(/^([^:]+):\s*(.*)/);
        if (m) branches.push({ label: m[1].trim(), text: m[2].trim() });
        i++;
      }
      if (branches.length) {
        html += '<div class="flow-branches">';
        branches.forEach(b => {
          html += '<div class="flow-branch"><b>' + escHtml(b.label) + '</b>' + escHtml(b.text) + '</div>';
        });
        html += '</div>';
      }
      needConn = true;
    } else {
      if (needConn) html += '<div class="flow-vconn">\u2193</div>';
      html += '<div class="flow-step">' + escHtml(line) + '</div>';
      needConn = true;
      i++;
    }
  }
  html += '</div>';
  return html;
}

// --- Sequence diagram ---
function renderSequence(text) {
  const lines = text.split('\n');
  const participants = [];
  const messages = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t === 'sequenceDiagram') continue;
    if (t.startsWith('participant ')) {
      participants.push(t.slice('participant '.length).trim());
    } else {
      const m = t.match(/^(.+?)\s*(->>|-->>)\s*(.+?):\s*(.+)/);
      if (m) messages.push({ from: m[1].trim(), dashed: m[2] === '-->>', to: m[3].trim(), msg: m[4].trim() });
    }
  }
  let html = '<div class="seq-wrap">';
  if (participants.length) {
    html += '<div class="seq-actors">';
    participants.forEach(p => { html += '<span class="seq-actor">' + escHtml(p) + '</span>'; });
    html += '</div>';
  }
  html += '<div class="seq-timeline">';
  messages.forEach(msg => {
    const self = msg.from === msg.to;
    const arrow = self ? '\u21BB' : (msg.dashed ? '\u21E2' : '\u2192');
    html += '<div class="seq-row' + (msg.dashed ? ' seq-row-dashed' : '') + '">';
    html += '<div class="seq-dir"><span class="seq-from">' + escHtml(msg.from) + '</span>';
    html += '<span class="seq-arrow">' + arrow + '</span>';
    if (!self) html += '<span class="seq-to">' + escHtml(msg.to) + '</span>';
    html += '</div><div class="seq-text">' + escHtml(msg.msg) + '</div></div>';
  });
  html += '</div></div>';
  return html;
}

// --- Block renderers ---
function wrapDiagram(inner, label) {
  return '<div class="diagram-outer">' + inner + '<div class="diagram-outer-label">' + label + '</div></div>';
}

function renderMetric(text) {
  const items = text.trim().split('\n').map(line => {
    const parts = line.split('|');
    return parts.length >= 2 ? { value: parts[0].trim(), label: parts[1].trim() } : null;
  }).filter(Boolean);
  if (!items.length) return '';
  return '<div class="metric-row">' + items.map(it =>
    '<div class="metric-card"><div class="metric-value">' + escHtml(it.value) + '</div><div class="metric-label">' + escHtml(it.label) + '</div></div>'
  ).join('') + '</div>';
}

function renderImpact(text) {
  const lines = text.trim().split('\n');
  let trigger = '';
  const items = [];
  for (const line of lines) {
    if (/^\u89E6\u53D1\u70B9[:：]/.test(line)) {
      trigger = line.replace(/^\u89E6\u53D1\u70B9[:：]\s*/, '');
    } else if (line.startsWith('- ')) {
      items.push(line.slice(2));
    }
  }
  return '<div class="block-impact"><div class="impact-trigger">' + escHtml(trigger) + '</div>' +
    '<ul>' + items.map(it => '<li>' + escHtml(it) + '</li>').join('') + '</ul></div>';
}

function renderTabs(text) {
  const tabs = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^::tab\[(.+)\]\s*$/);
    if (m) { if (current) tabs.push(current); current = { label: m[1], lines: [] }; }
    else if (current) current.lines.push(line);
  }
  if (current) tabs.push(current);
  if (!tabs.length) return '';
  const id = 'tabs-' + Math.random().toString(36).slice(2, 8);
  const bar = tabs.map((t, i) =>
    '<button class="' + (i === 0 ? 'active' : '') + '" onclick="switchTab(\'' + id + '\',' + i + ')">' + escHtml(t.label) + '</button>'
  ).join('');
  const panels = tabs.map((t, i) =>
    '<div class="tab-panel ' + (i === 0 ? 'active' : '') + '" data-tab-group="' + id + '" data-tab-index="' + i + '">' + md.render(t.lines.join('\n')) + '</div>'
  ).join('');
  return '<div class="block-tabs"><div class="tab-bar">' + bar + '</div>' + panels + '</div>';
}

function switchTab(group, index) {
  document.querySelectorAll('[data-tab-group="' + group + '"]').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-tab-group="' + group + '"][data-tab-index="' + index + '"]').classList.add('active');
  const bar = document.querySelector('[data-tab-group="' + group + '"]').closest('.block-tabs').querySelector('.tab-bar');
  bar.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === index));
}

function renderSegments(segments) {
  return segments.map(seg => {
    switch (seg.type) {
      case 'md': return postProcessConceptCards(md.render(seg.text));
      case 'mermaid': return wrapDiagram(renderMermaid(seg.text.trim()), 'FLOW');
      case 'sequence': return wrapDiagram(renderSequence(seg.text.trim()), 'SEQUENCE');
      case 'mindmap': return wrapDiagram(renderMindmap(seg.text.trim()), 'MINDMAP');
      case 'tooltip':
        return '<div class="block-tooltip" onclick="this.classList.toggle(\'open\')">' +
          '<div class="block-tooltip-header">' + ICONS.chevron + ' 技术细节</div>' +
          '<div class="tooltip-body">' + md.render(seg.text) + '</div></div>';
      case 'callout': return '<div class="block-callout">' + md.render(seg.text) + '</div>';
      case 'impact': return renderImpact(seg.text);
      case 'tabs': return renderTabs(seg.text);
      case 'metric': return renderMetric(seg.text);
      default: return md.render(seg.text);
    }
  }).join('');
}

// --- Nav & scroll spy ---
function slugify(text) {
  return text.trim()
    .replace(/[\s\u3000（）()【】\[\]「」《》、，。！？]/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '') || 'sec';
}
const slugCounts = {};
function uniqueSlug(base) {
  const count = (slugCounts[base] || 0) + 1;
  slugCounts[base] = count;
  return count === 1 ? base : base + '-' + count;
}

function buildNav(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const links = [];
  tmp.querySelectorAll('h2, h3').forEach(el => {
    const id = uniqueSlug(slugify(el.textContent));
    el.id = id;
    links.push({ id, text: el.textContent, level: el.tagName });
  });
  document.getElementById('content').innerHTML = tmp.innerHTML;
  document.getElementById('nav-links').innerHTML = links.map(l =>
    '<a href="#' + l.id + '" class="' + (l.level === 'H3' ? 'sub' : '') + '">' + l.text + '</a>'
  ).join('');
}

function setupScrollSpy() {
  const headings = document.querySelectorAll('h2[id], h3[id]');
  const navLinks = document.querySelectorAll('#nav-links a');
  if (!headings.length) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        navLinks.forEach(a => a.classList.remove('active'));
        const link = document.querySelector('#nav-links a[href="#' + entry.target.id + '"]');
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  headings.forEach(h => observer.observe(h));
}

function init() {
  const segments = parseBlocks(RAW);
  const html = renderSegments(segments);
  buildNav(html);
  setupScrollSpy();
  const h1 = document.querySelector('h1');
  if (h1) document.title = h1.textContent + ' \u2014 Panova';
}

init();
