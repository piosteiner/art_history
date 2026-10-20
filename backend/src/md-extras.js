// Markdown beyond CommonMark, shared by the entries' texts (src/markdown.js) and the pages (src/pages.js) — the forms
// the admin editor's toolbar writes (as in the adenai map's editor, and as Obsidian has them):
//   ==highlighted==                → <mark>
//   ||spoiler||                    → <span class="spoiler" tabindex="0">: hidden until clicked or focused (CSS only)
//   ++underlined++                 → <u>                    (option underline; src/markdown.js has its own rule)
//   - [ ] open · - [x] done        → <li class="task[ task-done]"><span class="task-box">☐/☑</span>
//   > [!warning] Own title         → <blockquote class="callout callout-warning"><p class="callout-title">Own title</p>…
//     > the box's text                (without a title: the type's name in the page's language)
// The sanitizers of both renderers allow exactly these classes.

// ==x==, ||x||, ++x++: the inner text parsed as usual (bold, links inside work); a lone "==" / "||" / "++" stays text
function pair(md, name, marker, tag, attrs = []) {
  const code = marker.charCodeAt(0);
  const re = new RegExp(`^${marker.replace(/[|+]/g, '\\$&')}(?=\\S)([^\\n]*?\\S)${marker.replace(/[|+]/g, '\\$&')}`);
  md.inline.ruler.before('emphasis', name, (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== code || state.src.charCodeAt(state.pos + 1) !== code) return false;
    const m = re.exec(state.src.slice(state.pos, state.posMax));
    if (!m) return false;
    if (!silent) {
      const start = state.pos + 2;
      const end = start + m[1].length;
      const max = state.posMax;
      const open = state.push(`${name}_open`, tag, 1);
      attrs.forEach(([k, v]) => open.attrSet(k, v));
      state.pos = start;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = max;
      state.push(`${name}_close`, tag, -1);
      state.pos = end + 2;
    } else state.pos += m[0].length;
    return true;
  });
}

const CALLOUT = {
  en: { note: 'Note', info: 'Info', tip: 'Tip', warning: 'Warning', important: 'Important', quote: 'Quote', example: 'Example', todo: 'To do', question: 'Question' },
  de: { note: 'Notiz', info: 'Info', tip: 'Tipp', warning: 'Achtung', important: 'Wichtig', quote: 'Zitat', example: 'Beispiel', todo: 'Offen', question: 'Frage' },
};
const CALLOUT_TYPES = Object.keys(CALLOUT.en);

function extras(md, { underline = false } = {}) {
  pair(md, 'mark', '==', 'mark');
  // ||spoiler||: markdown-it's text rule doesn't stop at "|", so an inline rule would never see it — the text tokens
  // are split afterwards instead (formatting inside a spoiler stays as typed)
  md.core.ruler.after('inline', 'spoilers', (state) => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children || !block.content.includes('||')) continue;
      const out = [];
      for (const t of block.children) {
        if (t.type !== 'text' || !t.content.includes('||')) { out.push(t); continue; }
        let rest = t.content;
        for (let m = /\|\|(?=\S)([^|\n]*?\S)\|\|/.exec(rest); m; m = /\|\|(?=\S)([^|\n]*?\S)\|\|/.exec(rest)) {
          const before = new state.Token('text', '', 0); before.content = rest.slice(0, m.index);
          const open = new state.Token('spoiler_open', 'span', 1);
          open.attrs = [['class', 'spoiler'], ['tabindex', '0'], ['title', 'Click to show']];
          const inner = new state.Token('text', '', 0); inner.content = m[1];
          out.push(before, open, inner, new state.Token('spoiler_close', 'span', -1));
          rest = rest.slice(m.index + m[0].length);
        }
        const tail = new state.Token('text', '', 0); tail.content = rest;
        out.push(tail);
      }
      block.children = out;
    }
  });
  if (underline) pair(md, 'underline', '++', 'u');

  // task lists: a list item starting with [ ] or [x]
  md.core.ruler.push('task_lists', (state) => {
    for (let i = 2; i < state.tokens.length; i++) {
      const t = state.tokens[i];
      if (t.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' || state.tokens[i - 2].type !== 'list_item_open') continue;
      const m = /^\[([ xX])\]\s+/.exec(t.content);
      if (!m) continue;
      const done = m[1] !== ' ';
      const first = t.children[0];
      if (first && first.type === 'text') first.content = first.content.replace(/^\[[ xX]\]\s+/, '');
      const box = new state.Token('html_inline', '', 0);
      box.content = `<span class="task-box" aria-label="${done ? 'done' : 'open'}">${done ? '☑' : '☐'}</span> `;
      t.children.unshift(box);
      state.tokens[i - 2].attrJoin('class', done ? 'task task-done' : 'task');
    }
  });

  // callouts: a quote whose first line is [!type] (Obsidian's; an unknown type shows as a note)
  md.core.ruler.push('callouts', (state) => {
    const lang = String((state.env && state.env.lang) || 'en').slice(0, 2) === 'de' ? 'de' : 'en';
    for (let i = 0; i + 2 < state.tokens.length; i++) {
      if (state.tokens[i].type !== 'blockquote_open' || state.tokens[i + 1].type !== 'paragraph_open') continue;
      const inline = state.tokens[i + 2];
      const m = /^\[!([a-zA-Z]+)\][+-]?[ \t]*([^\n]*)/.exec(inline.content || '');
      if (!m) continue;
      const type = CALLOUT_TYPES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : 'note';
      state.tokens[i].attrJoin('class', `callout callout-${type}`);
      // the marker line out of the paragraph (the rest of it is the box's text)
      const kids = inline.children;
      const cut = kids.findIndex((k) => k.type === 'softbreak' || k.type === 'hardbreak');
      const titleKids = cut < 0 ? kids : kids.slice(0, cut);
      inline.children = cut < 0 ? [] : kids.slice(cut + 1);
      if (titleKids[0] && titleKids[0].type === 'text') titleKids[0].content = titleKids[0].content.replace(/^\[![a-zA-Z]+\][+-]?[ \t]*/, '');
      const ownTitle = titleKids.some((k) => k.type !== 'text' || k.content.trim());
      const title = new state.Token('callout_title', 'p', 0);
      title.meta = { kids: ownTitle ? titleKids : null, label: CALLOUT[lang][type] };
      if (!inline.children.length) state.tokens.splice(i + 1, 3, title);   // nothing but the title
      else state.tokens.splice(i + 1, 0, title);
    }
  });
  md.renderer.rules.callout_title = (tokens, idx, options, env, self) => {
    const { kids, label } = tokens[idx].meta;
    return `<p class="callout-title">${kids ? self.renderInline(kids, options, env) : md.utils.escapeHtml(label)}</p>\n`;
  };
}

// what the sanitizers must let through for these (merged into each renderer's own lists)
const ALLOW = {
  tags: ['mark', 'u', 'blockquote', 'p', 'span', 'li'],
  attributes: { span: ['class', 'tabindex', 'title', 'aria-label'], li: ['class'], blockquote: ['class'], p: ['class'] },
  classes: {
    span: ['spoiler', 'task-box'], li: ['task', 'task-done'], p: ['callout-title'],
    blockquote: ['callout', ...CALLOUT_TYPES.map((t) => `callout-${t}`)],
  },
};

module.exports = { extras, ALLOW, CALLOUT_TYPES };
