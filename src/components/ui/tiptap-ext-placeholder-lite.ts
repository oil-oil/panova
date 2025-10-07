"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface PlaceholderLiteOptions {
  placeholder: string;
}

export const PlaceholderLite = Extension.create<PlaceholderLiteOptions>({
  name: 'placeholderLite',

  addOptions() { return { placeholder: '' }; },

  addProseMirrorPlugins() {
    const placeholder = this.options.placeholder || '';
    return [
      new Plugin({
        key: new PluginKey('placeholderLite'),
        props: {
          decorations: (state) => {
            const { doc } = state;
            const first = doc.firstChild as any;
            const isEmpty = doc.childCount === 1 && first && first.isTextblock && first.content.size === 0;
            if (!isEmpty) return null;
            const deco = Decoration.widget(1, () => {
              const span = document.createElement('span');
              span.className = 'text-muted-foreground pointer-events-none select-none';
              span.style.position = 'absolute';
              span.style.left = '0.5rem';
              span.style.top = '0.25rem';
              span.style.opacity = '0.6';
              span.textContent = placeholder;
              return span;
            }, { side: -1 });
            return DecorationSet.create(doc, [deco]);
          },
        },
      }),
    ];
  },
});

