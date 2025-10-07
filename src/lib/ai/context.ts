import type { FeatureNode } from "@/types/feature-tree";
import { htmlToMarkdownWithTable, stripHtml } from "@/lib/markdown";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type MinimalNode = { id: string; title: string; parentId: string | null; order: number; status?: string; description?: string };

// Build a compact JSON snapshot for AI context (id/title/parentId/order/status only)
export function toAIJson(nodes: FeatureNode[]) {
  const minimal = nodes
    .map(n => {
      // Convert tiptap HTML to lightweight markdown; trim to reduce token load
      const md = n.description ? htmlToMarkdownWithTable(n.description) : "";
      const desc = md ? md.slice(0, 600) : ""; // cap per-node description length
      return { id: n.id, title: n.title, parentId: n.parentId, order: n.order, status: n.status, description: desc };
    })
    .sort((a,b)=> a.parentId===b.parentId ? a.order-b.order : (a.parentId??"").localeCompare(b.parentId??""));
  return JSON.stringify({ nodes: minimal }, null, 2);
}

export function contextMsgForTree(nodes: FeatureNode[]) {
  return { role: "user" as const, content: `特性树（JSON 最小快照）：\n${toAIJson(nodes)}` };
}

// Parse the feature-tree snapshot from messages (paired with contextMsgForTree format)
export function parseTreeFromMessages(messages: ReadonlyArray<unknown>): MinimalNode[] {
  for (const m of messages) {
    const contentVal = (m as { content?: unknown })?.content;
    const content: string = typeof contentVal === 'string' ? contentVal : '';
    const idx = content.indexOf("特性树（JSON 最小快照）：");
    if (idx >= 0) {
      const body = content.slice(idx + "特性树（JSON 最小快照）：".length).trim();
      try {
        const jsonStart = body.indexOf("{");
        const payload = jsonStart >= 0 ? body.slice(jsonStart) : body;
        const obj = JSON.parse(payload) as unknown;
        if (obj && typeof obj === 'object' && Array.isArray((obj as Record<string, unknown>).nodes)) {
          return (obj as { nodes: MinimalNode[] }).nodes;
        }
      } catch {}
    }
  }
  return [];
}
