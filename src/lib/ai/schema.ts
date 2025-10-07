import { z } from "zod";
import { FEATURE_ACTIONS as A, DOC_ACTIONS as D, PRODUCT_ACTIONS as P } from "@/lib/ai/actions";

export const ZNodeRef = z.object({ by: z.enum(["id","path"]), value: z.string() });
export const ZDocRef  = z.object({ by: z.enum(["id","title"]), value: z.string() });
export const ZFeatureStatus = z.enum(["implemented","developing","pending"]);

// Recursive tree node for bulk insert
export const ZAddTreeNode = z.lazy(() => z.object({
  id: z.string().optional(),
  title: z.string(),
  status: ZFeatureStatus.optional(),
  description: z.string().optional(),
  children: z.array(ZAddTreeNode).optional(),
}));

export const ZFeatureAction = z.union([
  // add: single node
  z.object({ action: z.literal(A.ADD),            title: z.string(), parent: ZNodeRef, index: z.number().int().optional(), status: ZFeatureStatus.optional(), description: z.string().optional(), id: z.string().optional() }),
  // add: nested tree variant (prefer this for批量)
  z.object({ action: z.literal(A.ADD),            parent: ZNodeRef, nodes: z.array(ZAddTreeNode), index: z.number().int().optional() }),
  z.object({ action: z.literal(A.ADD_TREE),       parent: ZNodeRef, nodes: z.array(ZAddTreeNode), index: z.number().int().optional() }),
  z.object({ action: z.literal(A.RENAME),         target: ZNodeRef, title: z.string() }),
  z.object({ action: z.literal(A.SET_DESCRIPTION),target: ZNodeRef, description: z.string() }),
  z.object({ action: z.literal(A.SET_STATUS),     target: ZNodeRef, status: ZFeatureStatus }),
  z.object({ action: z.literal(A.MOVE),           target: ZNodeRef, parent: ZNodeRef, index: z.number().int().optional() }),
  z.object({ action: z.literal(A.DELETE),         target: ZNodeRef }),
]);

export const ZDocAction = z.union([
  z.object({ action: z.literal(D.DOC_CREATE),      title: z.string(), content_md: z.string().optional(), id: z.string().optional() }),
  z.object({ action: z.literal(D.DOC_RENAME),      target: ZDocRef, title: z.string() }),
  z.object({ action: z.literal(D.DOC_SET_CONTENT), target: ZDocRef, content_md: z.string() }),
  z.object({ action: z.literal(D.DOC_DELETE),      target: ZDocRef }),
  // 局部修改补丁。format 默认 search_replace，更稳健；udiff 需遵循 @@ ... @@ + 空格/加/减 行的简化 unified diff
  z.object({ action: z.literal(D.DOC_PATCH),       target: ZDocRef, patch: z.string(), format: z.enum(["search_replace","udiff"]).optional() }),
]);

export const ZProductAction = z.union([
  z.object({ action: z.literal(P.PRODUCT_CREATE), name: z.string().optional(), id: z.string().optional() }),
  z.object({ action: z.literal(P.PRODUCT_SELECT), id: z.string() }),
]);

export const ZEnvelope = z.object({
  answer_md: z.string().optional(),
  actions: z.array(z.union([ZFeatureAction, ZDocAction, ZProductAction])).optional(),
  // Back-compat: allow doc_actions, but clients should merge it into actions and ignore this field further.
  doc_actions: z.array(ZDocAction).optional(),
});

export type EnvelopeOut = z.infer<typeof ZEnvelope>;

// ---- Helpers to build doc snippets from schema (best-effort) ----
function getShape(obj: unknown): Record<string, unknown> {
  try { return (obj as { _def?: { shape?: () => Record<string, unknown> } })._def?.shape?.() ?? {}; } catch {}
  try { return (obj as { shape?: Record<string, unknown> }).shape ?? {}; } catch {}
  return {};
}

function isEnumOf(obj: unknown, items: string[]): boolean {
  try {
    const def = (obj as { _def?: { values?: string[] }; options?: string[] }) || {};
    const opts = def._def?.values ?? def.options;
    return Array.isArray(opts) && items.every(v => (opts as string[]).includes(v));
  } catch { return false; }
}

function isNodeRef(obj: unknown): boolean {
  const s = getShape(obj);
  const by = (s.by as { _def?: { values?: string[] } }) || {};
  return isEnumOf(by, ["id","path"]) && (s.value as { _def?: { typeName?: string } })?._def?.typeName === 'ZodString';
}
function isDocRef(obj: unknown): boolean {
  const s = getShape(obj);
  const by = (s.by as { _def?: { values?: string[] } }) || {};
  return isEnumOf(by, ["id","title"]) && (s.value as { _def?: { typeName?: string } })?._def?.typeName === 'ZodString';
}

function typeStr(z: unknown): string {
  // unwrap optional
  const def = (z as { _def?: any })?._def; // partial introspection only
  if (def?.typeName === 'ZodOptional') return typeStr(def.innerType);
  if (def?.typeName === 'ZodEffects') return typeStr(def.schema);
  const t = def?.typeName || '';
  if (t === 'ZodString') return 'string';
  if (t === 'ZodNumber') return 'number';
  if (t === 'ZodBoolean') return 'boolean';
  if (t === 'ZodEnum') { try { return `('` + def.values.join(`'|'`) + `')`; } catch { return 'enum'; } }
  if (t === 'ZodLiteral') { try { return `'${String(def.value)}'`; } catch { return 'literal'; } }
  if (t === 'ZodObject') {
    if (isNodeRef(z)) return 'NodeRef';
    if (isDocRef(z)) return 'DocRef';
    return 'object';
  }
  return 'unknown';
}

function fmtProp(name: string, z: unknown): string {
  const def = (z as { _def?: any })?._def;
  const optional = def?.typeName === 'ZodOptional';
  const core = optional ? def.innerType : z;
  const t = typeStr(core);
  return `${name}${optional ? '?' : ''}:${t}`;
}

function buildDocFromUnion(union: unknown): string {
  const options: unknown[] = (union as { _def?: { options?: unknown[] } })?._def?.options || [];
  const lines: string[] = [];
  const preferOrder = ['action','title','target','parent','nodes','index','status','description','id'];
  for (const opt of options) {
    const shape = getShape(opt);
    // determine action literal label for the left side
    const actionLit = (shape?.action as { _def?: { value?: string } })?._def?.value ?? 'action';
    // ordered properties
    const keys = Object.keys(shape);
    const ordered = [...preferOrder.filter(k=>keys.includes(k)), ...keys.filter(k=>!preferOrder.includes(k)).sort()];
    const parts = ordered.map(k => fmtProp(k, shape[k]));
    lines.push(`  ${actionLit}:     { ${parts.join(', ')} }`);
  }
  return lines.join('\n');
}

export function buildFeatureActionDocSnippet(): string {
  return buildDocFromUnion(ZFeatureAction);
}
export function buildDocActionDocSnippet(): string {
  return buildDocFromUnion(ZDocAction);
}
export function buildProductActionDocSnippet(): string {
  return buildDocFromUnion(ZProductAction);
}
