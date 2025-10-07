"use client";

import React from "react";
import Image from "next/image";
import { useRouter } from "next/router";
import { ListTree, Plus, BookText, Pencil, Trash, AppWindowMac, FileText } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  docsAtom,
  selectedDocIdAtom,
  editingDocIdAtom,
  selectDocAtom,
  updateDocTitleAtom,
  deleteDocAtom,
  addDocAtom,
  loadDocsAtom,
  type Doc,
} from "@/lib/doc-atoms";
import {
  productsAtom,
  selectedProductIdAtom,
  selectProductAtom,
  addProductAtom,
  renameProductAtom,
  deleteProductAtom,
  loadProductsAtom,
  type Product,
} from "@/lib/feature-tree-atoms";
import { ContextMenu } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function DocItem({ doc, selected }: { doc: Doc; selected: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useAtom(editingDocIdAtom);
  const updateTitle = useSetAtom(updateDocTitleAtom);
  const remove = useSetAtom(deleteDocAtom);
  const setSelected = useSetAtom(selectDocAtom);
  const [title, setTitle] = React.useState(doc.title);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isEditing = editingId === doc.id;

  React.useEffect(() => { setTitle(doc.title); }, [doc.id, doc.title]);
  React.useEffect(() => { if (isEditing) inputRef.current?.select(); }, [isEditing]);

  const commit = () => {
    const t = (title || "").trim() || "未命名";
    if (t !== doc.title) updateTitle({ id: doc.id, title: t });
    setEditingId(null);
  };
  const cancel = () => { setTitle(doc.title); setEditingId(null); };

  return (
    <ContextMenu
      items={[
        { label: "重命名", icon: <Pencil className="h-4 w-4" />, onClick: () => setEditingId(doc.id) },
        { label: "删除", icon: <Trash className="h-4 w-4" />, onClick: () => remove(doc.id) },
      ]}
    >
      <div
        className={cn(
          "group relative h-8 pl-6 pr-2 text-sm select-none cursor-pointer transition-colors rounded-md flex items-center gap-2",
          selected ? "font-medium bg-muted" : "hover:bg-muted/80",
        )}
        onClick={() => { setSelected(doc.id); if (router.asPath !== `/docs/${doc.id}`) void router.push(`/docs/${doc.id}`); }}
      >
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        {isEditing ? (
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") cancel(); }}
            className="h-5 w-full px-0 py-0 text-sm border-0 bg-transparent focus-visible:ring-0"
          />
        ) : (
          <div className="truncate">{doc.title || "未命名"}</div>
        )}
      </div>
    </ContextMenu>
  );
}

export default function GlobalSidebar() {
  const router = useRouter();
  // 文档库（Doc）
  const [list] = useAtom(docsAtom);
  const [selectedId] = useAtom(selectedDocIdAtom);
  const add = useSetAtom(addDocAtom);
  const load = useSetAtom(loadDocsAtom);
  // Feature products (特性树下的产品)
  const products = useAtomValue(productsAtom);
  const [selectedPid] = useAtom(selectedProductIdAtom);
  const selectProduct = useSetAtom(selectProductAtom);
  const addProduct = useSetAtom(addProductAtom);
  const renameProduct = useSetAtom(renameProductAtom);
  const deleteProduct = useSetAtom(deleteProductAtom);
  const loadProducts = useSetAtom(loadProductsAtom);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { loadProducts(); }, [loadProducts]);

  return (
    <aside className="hidden lg:flex w-64 border-r border-border/60 bg-muted/40 flex-col z-30 sticky top-0 h-screen">
      {/* Brand header */}
      <div className="h-12 px-3 flex items-center gap-2">
        <Image src="/images/Panova.png" alt="Panova" width={24} height={24} className="h-6 w-6 rounded object-contain" />
        <span className="text-xl font-bold text-foreground tracking-wide">Panova</span>
      </div>
      {/* Feature Tree header + product list */}
      <div className="px-3 pt-3 pb-2">
        <div className="group w-full h-8 px-2 rounded-md flex items-center justify-between hover:bg-muted/80">
          <span className="inline-flex items-center gap-2 text-xs text-gray-500 font-medium">
            <ListTree className="h-3.5 w-3.5" />
            <span>特性树</span>
          </span>
          <button
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/70 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => addProduct(undefined)}
            aria-label="新增产品"
            title="新增产品"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="px-3 pb-2 cursor-default">
        <div className="flex flex-col gap-1.5">
          {products.map((p) => {
            const isFeatures = router.pathname.startsWith("/features");
            const selected = isFeatures && (p.id === selectedPid);
            return (
              <ProductItem
                key={p.id}
                product={p}
                selected={selected}
                onOpen={() => {
                  // select product and go to /features
                  selectProduct(p.id);
                  if (!isFeatures) void router.push("/features");
                }}
                onRename={(name) => renameProduct({ id: p.id, name })}
                onDelete={() => deleteProduct(p.id)}
              />
            );
          })}
        </div>
      </div>

      {/* Document Library header + doc list */}
      <div className="px-3 pb-2 cursor-default">
        <div className="group w-full h-8 px-2 rounded-md flex items-center justify-between hover:bg-muted/80">
          <span className="inline-flex items-center gap-2 text-xs text-gray-500 font-medium">
            <BookText className="h-3.5 w-3.5" />
            <span>文档库</span>
          </span>
          <button
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/70 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => add(undefined)}
            aria-label="新增文档"
            title="新增文档"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 pb-3">
        <div className="flex flex-col gap-1.5">
          {list.map((doc) => {
            const isFeatures = router.pathname.startsWith("/features");
            const selected = !isFeatures && (doc.id === selectedId);
            return <DocItem key={doc.id} doc={doc} selected={selected} />;
          })}
        </div>
      </div>
    </aside>
  );
}

function ProductItem({ product, selected, onOpen, onRename, onDelete }: { product: Product; selected: boolean; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [title, setTitle] = React.useState(product.name);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { setTitle(product.name); }, [product.id, product.name]);
  React.useEffect(() => { if (isEditing) inputRef.current?.select(); }, [isEditing]);

  const commit = () => {
    const t = (title || "").trim() || "未命名";
    if (t !== product.name) onRename(t);
    setIsEditing(false);
  };
  const cancel = () => { setTitle(product.name); setIsEditing(false); };

  return (
    <ContextMenu
      items={[
        { label: "重命名", icon: <Pencil className="h-4 w-4" />, onClick: () => setIsEditing(true) },
        { label: "删除", icon: <Trash className="h-4 w-4" />, onClick: () => onDelete() },
      ]}
    >
      <div
        className={cn(
          "group relative h-8 pl-6 pr-2 text-sm select-none cursor-pointer transition-colors rounded-md flex items-center gap-2",
          selected ? "font-medium bg-muted" : "hover:bg-muted/80",
        )}
        onClick={() => { if (!isEditing) onOpen(); }}
      >
        <AppWindowMac className="h-3.5 w-3.5 text-muted-foreground" />
        {isEditing ? (
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") cancel(); }}
            className="h-5 w-full px-0 py-0 text-sm border-0 bg-transparent focus-visible:ring-0"
          />
        ) : (
          <div className="truncate">{product.name || "未命名"}</div>
        )}
      </div>
    </ContextMenu>
  );
}
