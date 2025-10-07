// Centralized tool registry for the AI agent
// - Define tools once with name/label/description/schema/handler
// - Build LangChain tools array for the agent

import { z, type ZodTypeAny } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { getCurrentTaskInput, MessagesAnnotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { parseTreeFromMessages, type MinimalNode } from "@/lib/ai/context";
import { TOOL_LABELS } from "@/lib/ai/tools-catalog";

type ToolHandler<TInput> = (input: TInput, nodes: MinimalNode[]) => Promise<unknown> | unknown;

type ToolDef<TSchema extends ZodTypeAny, TInput = z.infer<TSchema>> = {
  name: string;
  label: string;
  description: string;
  schema: TSchema;
  handle: ToolHandler<TInput>;
};

// Concrete tool definitions
const defs = [
  {
    name: "search_features",
    label: TOOL_LABELS['search_features'],
    description: "按标题或描述关键字搜索功能节点，支持按产品 product_id 进行范围限定，返回简要列表。",
    schema: z.object({
      query: z.string().describe("搜索关键字，例如：'套餐'"),
      product_id: z.string().describe("产品 id（可从消息中的 @[label](prod://id) 解析）").optional(),
      limit: z.number().int().min(1).max(200).describe("最大返回条数").optional(),
    }),
    handle: async (input: { query: string; product_id?: string; limit?: number }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const q = (input.query || '').trim();
      if (!q) return { ok: false, reason: 'empty_query', results: [] };
      const limit = input.limit && Number.isFinite(input.limit) ? Math.min(200, Math.max(1, input.limit)) : 50;
      let sel = supabaseServer.from('feature_nodes')
        .select('id,title,parent_id,order,description,product_id')
        .order('product_id', { ascending: true, nullsFirst: true })
        .order('parent_id', { ascending: true, nullsFirst: true })
        .order('order', { ascending: true })
        .limit(limit);
      if (input.product_id) sel = sel.eq('product_id', input.product_id);
      // title 或 description 命中其一
      sel = sel.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      const { data, error } = await sel;
      if (error) return { ok: false, reason: error.message, results: [] };
      const results = (data || []).map((r: { id: string|number; title?: string|null; parent_id?: string|null }) => ({ id: String(r.id), title: r.title || '', parentId: r.parent_id ?? null }));
      return { ok: true, results };
    },
  },
  {
    name: "resolve_node",
    label: TOOL_LABELS['resolve_node'],
    description: "按路径（'/' 分隔）或 id 解析功能节点；可选 product_id 进行范围限定。",
    schema: z.object({ by: z.enum(["id", "path"]), value: z.string(), product_id: z.string().optional() }),
    handle: async (input: { by: "id" | "path"; value: string; product_id?: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      if (input.by === 'id') {
        let sel = supabaseServer.from('feature_nodes').select('id,title,parent_id,order,description,product_id').eq('id', input.value).limit(1);
        if (input.product_id) sel = sel.eq('product_id', input.product_id);
        const { data, error } = await sel;
        if (error) return { ok: false, reason: error.message };
        const row = (data || [])[0];
        if (!row) return { ok: false, reason: 'not_found' };
        const node = { id: String(row.id), title: row.title || '', parentId: row.parent_id ?? null, order: row.order ?? 0, description: row.description || '' };
        return { ok: true, node };
      }
      const parts = (input.value || '')
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.toLowerCase());
      if (parts.length === 0) return { ok: false, reason: 'empty_path' };
      let sel = supabaseServer.from('feature_nodes')
        .select('id,title,parent_id,order,description,product_id')
        .order('parent_id', { ascending: true, nullsFirst: true })
        .order('order', { ascending: true })
        .limit(5000);
      if (input.product_id) sel = sel.eq('product_id', input.product_id);
      const { data, error } = await sel;
      if (error) return { ok: false, reason: error.message };
      const nodes: MinimalNode[] = (data || []).map((r: { id: string|number; title?: string|null; parent_id?: string|null; order?: number|null; description?: string|null }) => ({ id: String(r.id), title: r.title || '', parentId: r.parent_id ?? null, order: r.order ?? 0, description: r.description || '' }));
      const byParent = (pid: string | null) => nodes.filter((n) => n.parentId === pid).sort((a, b) => a.order - b.order);
      let cur: MinimalNode | null = null;
      let list = byParent(null);
      for (const name of parts) {
        const m = list.find((n) => (n.title || '').trim().toLowerCase() === name) || null;
        if (!m) return { ok: false, reason: 'not_found' };
        cur = m;
        list = byParent(cur.id);
      }
      return cur ? { ok: true, node: cur } : { ok: false, reason: 'not_found' };
    },
  },
  // ---- 文档工具（供 AI 按需查询）----
  {
    name: "list_docs",
    label: TOOL_LABELS['list_docs'],
    description: "获取文档库的文档列表，可选关键字过滤，返回 id 和标题。",
    schema: z.object({
      query: z.string().describe("标题关键字").optional(),
      limit: z.number().int().min(1).max(200).describe("最大返回条数").optional(),
    }),
    handle: async (input: { query?: string; limit?: number }, _nodes: MinimalNode[]) => {
      // Avoid importing client-only supabase; use server-side client
      const { supabaseServer } = await import("@/lib/supabase/server");
      const q = (input.query || "").trim();
      const limit = input.limit && Number.isFinite(input.limit) ? Math.min(200, Math.max(1, input.limit)) : 100;
      const sel = supabaseServer.from("docs").select("id,title").order("id", { ascending: true }).limit(limit);
      const { data, error } = q ? await sel.ilike("title", `%${q}%`) : await sel;
      if (error) return { ok: false, reason: error.message };
      return { ok: true, results: (data || []).map((r: { id: string|number; title?: string|null }) => ({ id: String(r.id), title: r.title || "" })) };
    },
  },
  {
    name: "get_doc",
    label: TOOL_LABELS['get_doc'],
    description: "按 id 或标题读取单个文档，返回标题、HTML 与 Markdown 文本。",
    schema: z.object({
      by: z.enum(["id", "title"]).describe("按 id 或标题查询"),
      value: z.string().describe("对应的 id 或标题"),
    }),
    handle: async (input: { by: "id" | "title"; value: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const { htmlToMarkdownLite } = await import("@/lib/markdown");
      const sel = supabaseServer.from("docs").select("id,title,content").limit(1);
      const { data, error } = input.by === "id"
        ? await sel.eq("id", input.value)
        : await sel.ilike("title", input.value);
      if (error) return { ok: false, reason: error.message };
      const row = (data || [])[0];
      if (!row) return { ok: false, reason: "not_found" };
      const content_html = row.content || "";
      const content_md = htmlToMarkdownLite(content_html);
      return { ok: true, doc: { id: String(row.id), title: row.title || "", content_html, content_md } };
    },
  },
  // ---- 产品列表（供 AI 按需查询）----
  {
    name: "list_products",
    label: TOOL_LABELS['list_products'],
    description: "获取产品列表，可选名称关键字过滤，返回 id 和名称。",
    schema: z.object({
      query: z.string().describe("产品名称关键字").optional(),
      limit: z.number().int().min(1).max(200).describe("最大返回条数").optional(),
    }),
    handle: async (input: { query?: string; limit?: number }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const q = (input.query || "").trim();
      const limit = input.limit && Number.isFinite(input.limit) ? Math.min(200, Math.max(1, input.limit)) : 100;
      const sel = supabaseServer.from("products").select("id,name").order("name", { ascending: true }).limit(limit);
      const { data, error } = q ? await sel.ilike("name", `%${q}%`) : await sel;
      if (error) return { ok: false, reason: error.message };
      return { ok: true, results: (data || []).map((r: { id: string|number; name?: string|null }) => ({ id: String(r.id), name: r.name || "" })) };
    },
  },
  // ---- 文档库：增删改 ----
  {
    name: "create_doc",
    label: TOOL_LABELS['create_doc'],
    description: "在文档库中创建新文档，可选初始标题与 Markdown 内容。返回新文档 id。",
    schema: z.object({
      title: z.string().describe("标题").optional(),
      content_md: z.string().describe("初始 Markdown 内容").optional(),
    }),
    handle: async (input: { title?: string; content_md?: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const { markdownToHtml } = await import("@/lib/markdown");
      const { genId } = await import("@/lib/utils");
      const id = genId('doc');
      const title = (input.title || '').trim() || '未命名';
      const content = input.content_md ? markdownToHtml(input.content_md) : '';
      const { error } = await supabaseServer.from('docs').insert({ id, title, content });
      if (error) return { ok: false, reason: error.message };
      return { ok: true, id };
    },
  },
  {
    name: "set_doc_title",
    label: TOOL_LABELS['set_doc_title'],
    description: "设置指定文档的标题。",
    schema: z.object({ id: z.string().describe("文档 id"), title: z.string().describe("新标题") }),
    handle: async (input: { id: string; title: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const { error } = await supabaseServer.from('docs').update({ title: input.title }).eq('id', input.id);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    },
  },
  {
    name: "set_doc_content",
    label: TOOL_LABELS['set_doc_content'],
    description: "用 Markdown 内容覆盖写入指定文档（会转换为 HTML 存储）。",
    schema: z.object({ id: z.string().describe("文档 id"), content_md: z.string().describe("Markdown 内容") }),
    handle: async (input: { id: string; content_md: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const { markdownToHtml } = await import("@/lib/markdown");
      const content = markdownToHtml(input.content_md || '');
      const { error } = await supabaseServer.from('docs').update({ content }).eq('id', input.id);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    },
  },
  {
    name: "delete_doc",
    label: TOOL_LABELS['delete_doc'],
    description: "按 id 删除文档。",
    schema: z.object({ id: z.string().describe("文档 id") }),
    handle: async (input: { id: string }, _nodes: MinimalNode[]) => {
      const { supabaseServer } = await import("@/lib/supabase/server");
      const { error } = await supabaseServer.from('docs').delete().eq('id', input.id);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    },
  },
] as const satisfies ReadonlyArray<ToolDef<ZodTypeAny>>;

export type ToolName = typeof defs[number]["name"];
export const TOOL_LABELS_INTERNAL: Record<ToolName, string> = Object.fromEntries(defs.map((d) => [d.name, d.label])) as Record<ToolName, string>;

// Build LangChain tool objects consumable by the agent
export function buildTools() {
  // Full toolset: includes write-capable doc tools. Use ONLY when you explicitly want the agent to modify data.
  return defs.map((d) => new DynamicStructuredTool({
    name: d.name,
    description: d.description,
    schema: d.schema,
    func: async (input: unknown, _runManager, _config?: LangGraphRunnableConfig) => {
      const state = getCurrentTaskInput() as typeof MessagesAnnotation.State;
      const nodes = parseTreeFromMessages(state.messages as ReadonlyArray<unknown>);
      return await d.handle(input as unknown as z.infer<typeof d.schema>, nodes);
    },
  }));
}

// Reader-only tools: safe set for proposing changes without performing writes.
export function buildReaderTools() {
  const include = new Set(["search_features", "resolve_node", "list_docs", "get_doc", "list_products"]);
  const filtered = defs.filter((d) => include.has(d.name));
  return filtered.map((d) => new DynamicStructuredTool({
    name: d.name,
    description: d.description,
    schema: d.schema,
    func: async (input: unknown, _runManager, _config?: LangGraphRunnableConfig) => {
      const state = getCurrentTaskInput() as typeof MessagesAnnotation.State;
      const nodes = parseTreeFromMessages(state.messages as ReadonlyArray<unknown>);
      return await d.handle(input as unknown as z.infer<typeof d.schema>, nodes);
    },
  }));
}
// Ensure this module is server-only in Next.js bundling
import "server-only";
