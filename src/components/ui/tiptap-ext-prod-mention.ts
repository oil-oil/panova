"use client";

import { Node, mergeAttributes } from "@tiptap/core";

export interface ProdMentionOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    prodMention: {
      insertProdMention: (attrs: { id: string; label: string }) => ReturnType;
    }
  }
}

export const ProdMention = Node.create<ProdMentionOptions>({
  name: 'prodMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (element) => (element as HTMLElement).getAttribute('data-id') || '',
        renderHTML: (attributes) => ({ 'data-id': attributes.id }),
      },
      label: {
        default: '',
        parseHTML: (element) => {
          const el = element as HTMLElement;
          const viaAttr = el.getAttribute('data-label');
          if (viaAttr && typeof viaAttr === 'string') return viaAttr;
          const txt = (el.textContent || '').trim();
          return txt.startsWith('@') ? txt.slice(1) : txt;
        },
        renderHTML: (attributes) => ({ 'data-label': attributes.label }),
      },
    };
  },

  parseHTML() { return [{ tag: 'span[data-prod-mention]' }]; },

  renderHTML({ HTMLAttributes, node }) {
    const label = (node.attrs.label || '').toString();
    const cls = [
      'inline-flex items-center',
      'rounded-sm',
      'px-1 py-0.5',
      'border',
      'bg-sky-50 text-sky-700 border-sky-600/30',
      'whitespace-nowrap',
      'align-baseline',
      'text-xs',
      'mr-1',
    ].join(' ');
    return ['span', mergeAttributes({
      'data-prod-mention': '1',
      'data-id': node.attrs.id,
      'data-label': node.attrs.label,
      class: cls,
      contenteditable: 'false',
    }, HTMLAttributes), ['span', { class: 'opacity-80 mr-0.5' }, '@'], ['span', {}, label]];
  },

  addCommands() {
    return {
      insertProdMention:
        (attrs: { id: string; label: string }) =>
        ({ chain }) => chain().insertContent({ type: this.name, attrs }).run(),
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, dispatch } = this.editor.view; const { selection } = state; if (!selection.empty) return false;
        const $from: any = selection.$from; const nodeBefore = $from.nodeBefore;
        if (nodeBefore && nodeBefore.type === this.type) { const from = $from.pos - nodeBefore.nodeSize; const tr = state.tr.delete(from, $from.pos); dispatch(tr); return true; }
        return false;
      },
      Delete: () => {
        const { state, dispatch } = this.editor.view; const { selection } = state; if (!selection.empty) return false;
        const $from: any = selection.$from; const nodeAfter = $from.nodeAfter;
        if (nodeAfter && nodeAfter.type === this.type) { const to = $from.pos + nodeAfter.nodeSize; const tr = state.tr.delete($from.pos, to); dispatch(tr); return true; }
        return false;
      },
    };
  },
});

