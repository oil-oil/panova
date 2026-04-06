const RAW = `__REPORT_CONTENT__`;

// --- Icons ---
const ICONS = {
  create: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/></svg>',
  impact: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M10 5l3 3-3 3"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4l4 4-4 4"/></svg>',
};

// --- Mindmap branch colors ---
const BRANCH_COLORS = [
  { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
  { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
  { bg: '#f0fdfa', text: '#115e59', border: '#99f6e4' },
  { bg: '#faf5ff', text: '#6b21a8', border: '#d8b4fe' },
  { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
];

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
    '<div class="concept-attr attr-create"><div class="concept-attr-icon">' + ICONS.create + '</div><div class="concept-attr-body"><strong>怎么产生</strong><p>$1</p></div></div>'
  );
  html = html.replace(
    /<p><strong>影响范围[：:]\s*<\/strong>\s*([\s\S]*?)<\/p>/g,
    '<div class="concept-attr attr-impact"><div class="concept-attr-icon">' + ICONS.impact + '</div><div class="concept-attr-body"><strong>影响范围</strong><p>$1</p></div></div>'
  );
  return html;
}

// --- Wrap concept sections into cards (DOM-based) ---
function generateConceptGrid() {
  const cards = document.querySelectorAll('.concept-card');
  if (!cards.length) return;

  // Find the first concept card's parent
  const firstCard = cards[0];
  const parent = firstCard.parentNode;

  // Build grid data
  const gridItems = [];
  cards.forEach((card, i) => {
    const h3 = card.querySelector('h3');
    if (!h3) return;
    const id = h3.id;
    const text = h3.textContent || '';
    // Parse "中文名 (EnglishName)"
    const m = text.match(/^(.+?)\s*[（(](.+?)[)）]\s*$/);
    const cn = m ? m[1].trim() : text.trim();
    const en = m ? m[2].trim() : '';

    // Get first paragraph as description
    const firstP = card.querySelector('p');
    const desc = firstP ? firstP.textContent.trim() : '';

    gridItems.push({ id, cn, en, desc });
  });

  if (!gridItems.length) return;

  // Build grid HTML — clean list with dividers
  let html = '<div class="concept-grid" id="concept-grid-overview">';
  gridItems.forEach(item => {
    html += '<a class="concept-grid-item" href="#' + item.id + '">';
    html += '<div class="concept-grid-name">' + escHtml(item.cn);
    if (item.en) html += ' <span class="concept-grid-en">' + escHtml(item.en) + '</span>';
    html += '</div>';
    if (item.desc) html += '<div class="concept-grid-desc">' + escHtml(item.desc) + '</div>';
    html += '</a>';
  });
  html += '</div>';

  // Insert before first concept card
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  parent.insertBefore(wrapper.firstElementChild, firstCard);
}

function wrapConceptCards() {
  const attrs = document.querySelectorAll('.concept-attr');
  attrs.forEach(attr => {
    if (attr.closest('.concept-card')) return;
    // Find preceding h3
    let h3 = attr.previousElementSibling;
    while (h3 && h3.tagName !== 'H3') h3 = h3.previousElementSibling;
    if (!h3) return;
    if (h3.closest('.concept-card')) return;

    // Collect elements from h3 to next h2/h3
    const wrapper = document.createElement('div');
    wrapper.className = 'concept-card';
    h3.parentNode.insertBefore(wrapper, h3);

    const toMove = [];
    let el = h3;
    while (el) {
      if (el !== h3 && el.nodeType === 1 && (el.tagName === 'H2' || el.tagName === 'H3')) break;
      toMove.push(el);
      el = el.nextSibling;
    }
    toMove.forEach(e => wrapper.appendChild(e));

    // Append back-to-overview link
    const backLink = document.createElement('a');
    backLink.className = 'concept-back-link';
    backLink.href = '#concept-grid-overview';
    backLink.textContent = '\u2191 \u8FD4\u56DE\u6982\u5FF5\u603B\u89C8';
    wrapper.appendChild(backLink);
  });
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

function renderMindmapNode(node, depth, branchIndex) {
  const hasChildren = node.children.length > 0;
  const toggle = hasChildren ? '<span class="mm-toggle">\u25BE</span>' : '';
  const clickAttr = hasChildren ? ' onclick="toggleMM(this)"' : '';

  let styleAttr = '';
  if (depth === 1 && branchIndex >= 0) {
    const c = BRANCH_COLORS[branchIndex % BRANCH_COLORS.length];
    styleAttr = ' style="background:' + c.bg + ';color:' + c.text + ';border:1px solid ' + c.border + '"';
  }

  let html = '<div class="mm-node mm-l' + depth + '">';
  html += '<div class="mm-label' + (hasChildren ? ' mm-expandable' : '') + '"' + clickAttr + styleAttr + '>' + toggle + escHtml(node.text) + '</div>';
  if (hasChildren) {
    html += '<div class="mm-children">';
    node.children.forEach((c, i) => {
      html += renderMindmapNode(c, depth + 1, depth === 0 ? i : branchIndex);
    });
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderMindmap(text) {
  const nodes = parseMindmapTree(text);
  let html = '<div class="block-mindmap-tree">';
  nodes.forEach((n, i) => { html += renderMindmapNode(n, 0, i); });
  html += '</div>';
  return html;
}

function toggleMM(label) {
  label.closest('.mm-node').classList.toggle('mm-collapsed');
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
  return '<div class="block-impact" onclick="this.classList.toggle(\'open\')">' +
    '<div class="impact-trigger">' + escHtml(trigger) + '<span class="impact-toggle">\u25B8</span></div>' +
    '<div class="impact-items"><ul>' + items.map(it => '<li>' + escHtml(it) + '</li>').join('') + '</ul></div></div>';
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

// --- Block renderers ---
function renderSegments(segments) {
  return segments.map(seg => {
    switch (seg.type) {
      case 'md': return postProcessConceptCards(md.render(seg.text));
      case 'mermaid':
        return '<div class="diagram-outer"><pre class="mermaid">' + escHtml(seg.text.trim()) + '</pre><div class="diagram-outer-label">FLOW</div></div>';
      case 'sequence': return wrapDiagram(renderSequence(seg.text.trim()), 'SEQUENCE');
      case 'mindmap': return renderMindmap(seg.text.trim());
      case 'tooltip':
        return '<div class="block-tooltip" onclick="this.classList.toggle(\'open\')">' +
          '<div class="block-tooltip-header">' + ICONS.chevron + ' 技术细节</div>' +
          '<div class="tooltip-body">' + md.render(seg.text) + '</div></div>';
      case 'callout': return '<div class="block-callout">' + md.render(seg.text) + '</div>';
      case 'impact': return renderImpact(seg.text);
      case 'tabs': return renderTabs(seg.text);
      case 'metric': return renderMetric(seg.text);
      case 'demo':
        var demoId = 'demo-' + Math.random().toString(36).slice(2, 8);
        var demoBody = seg.text.trim().replace(/"/g, '&quot;').replace(/<\//g, '&lt;/');
        var demoCSS = [
          '*{margin:0;padding:0;box-sizing:border-box}',
          'body{font-family:-apple-system,&quot;Helvetica Neue&quot;,&quot;PingFang SC&quot;,&quot;Noto Sans SC&quot;,sans-serif;padding:20px;background:transparent;color:#1a1a1a;line-height:1.6;overflow:hidden;font-size:14px}',
          ':root{--black:#37352f;--gray-900:#1a1a1a;--gray-700:#555;--gray-500:#888;--gray-400:#aaa;--gray-300:#ccc;--gray-200:#e5e5e5;--gray-100:#f5f5f5;--gray-50:#fafafa;--white:#fff;--radius:8px;--radius-sm:6px;--radius-full:9999px}',
          '.card{background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius);padding:16px}',
          '.card-sm{background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-sm);padding:10px 14px}',
          '.row{display:flex;gap:12px;align-items:center}',
          '.col{display:flex;flex-direction:column;gap:8px}',
          '.wrap{display:flex;flex-wrap:wrap;gap:8px}',
          '.center{display:flex;align-items:center;justify-content:center}',
          '.gap-sm{gap:6px}.gap-lg{gap:16px}',
          '.text-xs{font-size:11px}.text-sm{font-size:12px}.text-md{font-size:14px}.text-lg{font-size:16px}.text-xl{font-size:20px}',
          '.text-bold{font-weight:700}.text-medium{font-weight:500}',
          '.text-black{color:var(--black)}.text-gray{color:var(--gray-500)}.text-light{color:var(--gray-400)}.text-white{color:var(--white)}',
          '.bg-black{background:var(--black)}.bg-dark{background:var(--gray-900)}.bg-gray{background:var(--gray-100)}.bg-white{background:var(--white)}',
          '.pill{display:inline-flex;align-items:center;padding:6px 14px;border-radius:var(--radius-full);font-size:13px;white-space:nowrap}',
          '.pill-outline{border:1px solid var(--gray-200);background:var(--white)}',
          '.pill-filled{background:var(--black);color:var(--white)}',
          '.pill-active{background:var(--black);color:var(--white)}',
          '.btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 20px;border-radius:var(--radius);border:none;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}',
          '.btn-primary{background:var(--black);color:var(--white)}.btn-secondary{background:var(--gray-100);color:var(--black);border:1px solid var(--gray-200)}',
          '.btn-block{width:100%}',
          '.avatar{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}',
          '.avatar-sm{width:32px;height:32px;font-size:11px}.avatar-lg{width:48px;height:48px;font-size:14px}',
          '.avatar-dark{background:var(--black);color:var(--white)}.avatar-gray{background:var(--gray-100);color:var(--gray-700)}.avatar-outline{background:var(--white);border:2px solid var(--gray-200);color:var(--gray-700)}',
          '.bubble{padding:10px 14px;border-radius:2px 12px 12px 12px;line-height:1.6}.bubble-gray{background:var(--gray-100)}.bubble-light{background:var(--gray-50);border:1px solid var(--gray-200)}',
          '.divider{height:1px;background:var(--gray-200);margin:12px 0}',
          '.label{font-size:12px;color:var(--gray-500);margin-bottom:6px}',
          '.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:var(--radius-full);font-size:11px;font-weight:600}',
          '.badge-dark{background:var(--black);color:var(--white)}.badge-gray{background:var(--gray-100);color:var(--gray-700)}.badge-outline{border:1px solid var(--gray-300);color:var(--gray-700)}',
          '.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.status-active{background:var(--black)}.status-inactive{background:var(--gray-300)}.status-glow{box-shadow:0 0 8px rgba(0,0,0,0.3)}',
          '.mt-sm{margin-top:8px}.mt-md{margin-top:12px}.mt-lg{margin-top:16px}.mb-sm{margin-bottom:8px}.mb-md{margin-bottom:12px}.mb-lg{margin-bottom:16px}',
          '.text-center{text-align:center}.text-right{text-align:right}',
          '.w-full{width:100%}.max-w-sm{max-width:360px}.max-w-md{max-width:440px}.mx-auto{margin-left:auto;margin-right:auto}',
          '.opacity-30{opacity:0.3}.opacity-50{opacity:0.5}.opacity-70{opacity:0.7}',
          '.shadow-sm{box-shadow:0 1px 3px rgba(0,0,0,0.06)}'
        ].join('');
        var demoHead = '<!DOCTYPE html><html><head><meta charset=&quot;UTF-8&quot;><meta name=&quot;viewport&quot; content=&quot;width=device-width,initial-scale=1&quot;><style>' + demoCSS + '</style></head><body>';
        var demoTail = '&lt;script>new ResizeObserver(function(){parent.postMessage({type:&quot;demo-resize&quot;,id:&quot;' + demoId + '&quot;,h:document.body.scrollHeight},&quot;*&quot;)}).observe(document.body)&lt;/script></body></html>';
        return '<div class="block-demo">' +
          '<div class="demo-label">DEMO</div>' +
          '<iframe id="' + demoId + '" class="demo-frame" sandbox="allow-scripts" srcdoc="' + demoHead + demoBody + demoTail + '"></iframe></div>';
      default: return md.render(seg.text);
    }
  }).join('');
}

// --- Nav & scroll spy ---
function slugify(text) {
  return text.trim().toLowerCase()
    .replace(/[\s\u3000（）()【】\[\]「」《》、，。！？:：]/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'sec';
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

// --- Link validation ---
function validateLinks() {
  const links = document.querySelectorAll('#content a[href^="#"]');
  const ids = new Set();
  document.querySelectorAll('[id]').forEach(el => ids.add(el.id));
  let broken = 0;
  links.forEach(link => {
    const target = link.getAttribute('href').slice(1);
    if (target && !ids.has(target)) {
      console.warn('Broken link:', link.textContent, '\u2192 #' + target);
      broken++;
    }
  });
  if (broken) console.warn('\u26A0 Found ' + broken + ' broken anchor link(s). Check console for details.');
  return broken;
}

// --- Concept Link Popover ---
function setupConceptPopovers() {
  var popover = document.createElement('div');
  popover.id = 'concept-popover';
  document.body.appendChild(popover);

  var conceptMap = new Map();
  document.querySelectorAll('.concept-card').forEach(function(card) {
    var h3 = card.querySelector('h3');
    if (!h3 || !h3.id) return;
    var firstP = card.querySelector('p');
    var desc = firstP ? firstP.textContent.trim() : '';
    conceptMap.set(h3.id, {
      name: h3.textContent,
      desc: desc.length > 150 ? desc.substring(0, 150) + '...' : desc
    });
  });

  document.querySelectorAll('#content a[href^="#"]').forEach(function(link) {
    var targetId = link.getAttribute('href').slice(1);
    var data = conceptMap.get(targetId);
    if (!data) return;

    link.addEventListener('mouseenter', function() {
      popover.innerHTML = '<div class="cpop-name">' + escHtml(data.name) + '</div>' +
                          '<div class="cpop-desc">' + escHtml(data.desc) + '</div>';
      var rect = link.getBoundingClientRect();
      popover.style.left = rect.left + rect.width / 2 + 'px';
      popover.style.top = (rect.top - 8) + 'px';
      popover.classList.add('visible');
    });

    link.addEventListener('mouseleave', function() {
      popover.classList.remove('visible');
    });
  });
}

// --- Mobile Nav ---
function setupMobileNav() {
  var nav = document.getElementById('nav');
  if (!nav) return;

  // Create hamburger button
  var btn = document.createElement('button');
  btn.className = 'mobile-nav-toggle';
  btn.textContent = '\u2630';
  btn.setAttribute('aria-label', 'Toggle navigation');
  document.body.appendChild(btn);

  // Create overlay
  var overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  document.body.appendChild(overlay);

  btn.addEventListener('click', function() {
    nav.classList.toggle('nav-open');
    overlay.classList.toggle('visible');
  });

  overlay.addEventListener('click', function() {
    nav.classList.remove('nav-open');
    overlay.classList.remove('visible');
  });

  // Close nav when a link is clicked (mobile)
  nav.addEventListener('click', function(e) {
    if (e.target.tagName === 'A') {
      nav.classList.remove('nav-open');
      overlay.classList.remove('visible');
    }
  });
}

// --- Nav Search ---
function setupSearch() {
  var navTitle = document.querySelector('.nav-title');
  if (!navTitle) return;

  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'nav-search';
  input.placeholder = '\u641C\u7D22\u7AE0\u8282...';
  navTitle.parentNode.insertBefore(input, navTitle.nextSibling);

  input.addEventListener('input', function() {
    var query = input.value.trim().toLowerCase();
    var links = document.querySelectorAll('#nav-links a');
    links.forEach(function(link) {
      if (!query) {
        link.classList.remove('search-dimmed');
      } else {
        var text = link.textContent.toLowerCase();
        link.classList.toggle('search-dimmed', text.indexOf(query) === -1);
      }
    });
  });
}

// --- Init ---
function init() {
  const segments = parseBlocks(RAW);
  const html = renderSegments(segments);
  buildNav(html);
  wrapConceptCards();
  generateConceptGrid();
  setupScrollSpy();
  setupConceptPopovers();

  // Initialize mermaid
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        primaryColor: '#e3e2de',
        primaryTextColor: '#37352f',
        primaryBorderColor: '#d4d4d0',
        lineColor: '#b4b4b0',
        secondaryColor: '#f7f6f3',
        tertiaryColor: '#f7f6f3',
        noteBkgColor: '#fffbeb',
        noteTextColor: '#92400e',
        fontSize: '14px',
        fontFamily: 'inherit'
      },
      flowchart: {
        htmlLabels: true,
        curve: 'basis',
        padding: 16,
        nodeSpacing: 40,
        rankSpacing: 60,
        useMaxWidth: true,
        wrappingWidth: 180
      }
    });
    mermaid.run({ querySelector: 'pre.mermaid' });
  }

  // Demo iframe auto-resize
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'demo-resize') {
      var frame = document.getElementById(e.data.id);
      if (frame) frame.style.height = e.data.h + 'px';
    }
  });

  validateLinks();
  setupMobileNav();
  setupSearch();

  // Expand first impact chain by default
  const firstImpact = document.querySelector('.block-impact');
  if (firstImpact) firstImpact.classList.add('open');

  const h1 = document.querySelector('h1');
  if (h1) document.title = h1.textContent + ' \u2014 Panova';
}

init();
