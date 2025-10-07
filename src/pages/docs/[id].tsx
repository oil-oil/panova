"use client";

import React from "react";
import { useRouter } from "next/router";
import { useAtom, useSetAtom } from "jotai";
import { TiptapEditor } from "@/components/ui/tiptap-editor";
import {
  docsAtom,
  updateDocContentAtom,
  loadDocsAtom,
  selectedDocIdAtom,
  selectDocAtom,
} from "@/lib/doc-atoms";
import { AnimatePresence, motion } from "framer-motion";

export default function DocPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };
  const [list] = useAtom(docsAtom);
  const [selectedId] = useAtom(selectedDocIdAtom);
  const setSelected = useSetAtom(selectDocAtom);
  const updateContent = useSetAtom(updateDocContentAtom);
  const loadDocs = useSetAtom(loadDocsAtom);

  // Ensure docs loaded
  React.useEffect(() => { loadDocs(); }, [loadDocs]);

  // Keep global selected id in sync with route param
  React.useEffect(() => {
    if (!id) return;
    if (selectedId !== id) setSelected(id);
  }, [id, selectedId, setSelected]);

  const doc = React.useMemo(() => {
    const theId = id || selectedId || null;
    if (!theId) return null;
    return list.find((d) => d.id === theId) || null;
  }, [list, id, selectedId]);

  return (
    <div className="mx-auto w-full max-w-[840px]">
      <div className="mx-auto max-w-[840px]">
        <AnimatePresence mode="wait">
          {doc ? (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <TiptapEditor
                className="px-3 py-1.5"
                value={doc.content}
                onChange={(html) => updateContent({ id: doc.id, content: html })}
                containerClassName="min-h-[580px] rounded-lg bg-card border border-border/60"
                withToolbar
              />
            </motion.div>
          ) : (
            <div className="text-sm text-muted-foreground px-2 py-3">{id ? "未找到文档。" : "请选择左侧文档或新增。"}</div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
