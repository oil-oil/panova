// Shared, client-safe tool catalog: names and human labels only.
// Server tool implementations (handlers) live in src/lib/ai/tools.ts.

export type ToolKind = 'read' | 'write';
export type ToolCatalogEntry = { name: string; label: string; kind: ToolKind };

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  { name: 'search_features', label: '功能搜索', kind: 'read' },
  { name: 'resolve_node', label: '节点解析', kind: 'read' },
  { name: 'list_docs', label: '文档列表', kind: 'read' },
  { name: 'get_doc', label: '读取文档', kind: 'read' },
  { name: 'list_products', label: '产品列表', kind: 'read' },
  { name: 'create_doc', label: '新建文档', kind: 'write' },
  { name: 'set_doc_title', label: '重命名文档', kind: 'write' },
  { name: 'set_doc_content', label: '写入文档', kind: 'write' },
  { name: 'delete_doc', label: '删除文档', kind: 'write' },
];

export const TOOL_LABELS = Object.fromEntries(
  TOOL_CATALOG.map(e => [e.name, e.label])
) as Record<string, string>;

export const READ_TOOL_NAMES = TOOL_CATALOG.filter(e => e.kind === 'read').map(e => e.name);
export const WRITE_TOOL_NAMES = TOOL_CATALOG.filter(e => e.kind === 'write').map(e => e.name);
