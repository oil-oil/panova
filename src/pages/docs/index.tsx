"use client";

import React from "react";
import { useRouter } from "next/router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { docsAtom, selectedDocIdAtom, loadDocsAtom } from "@/lib/doc-atoms";

export default function DocsIndex() {
  const router = useRouter();
  const [list] = useAtom(docsAtom);
  const selectedId = useAtomValue(selectedDocIdAtom);
  const load = useSetAtom(loadDocsAtom);

  React.useEffect(() => { load(); }, [load]);

  // Redirect to an existing document if any
  React.useEffect(() => {
    const target = selectedId || (list.length ? list[0].id : null);
    if (target) { void router.replace(`/docs/${target}`); }
  }, [list, selectedId, router]);

  return (
    <div className="mx-auto w-full max-w-[840px]">
      <div className="mx-auto max-w-[840px] px-2 py-3 text-sm text-muted-foreground">
        请选择左侧“文档库”中的文档，或点击“+”新建。
      </div>
    </div>
  );
}
