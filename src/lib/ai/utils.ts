import type { Envelope, UnifiedAction, DocAction } from "@/types/ai";

// Try parse a JSON envelope from a plain text content.
export function tryParseAiEnvelope(text: string): Envelope | null {
  const raw = (text || '').trim(); if (!raw) return null;
  const m = raw.match(/```(?:json)?\n([\s\S]*?)```/i);
  const body = m ? m[1] : raw;
  try {
    const obj = JSON.parse(body) as unknown;
    if (obj && typeof obj === 'object') {
      const rec = obj as Record<string, unknown>;
      let actions: UnifiedAction[] | undefined = undefined;
      const ans = typeof rec.answer_md === 'string' ? (rec.answer_md as string) : undefined;
      if (Array.isArray(rec.actions)) actions = rec.actions as UnifiedAction[];
      // Back-compat: merge doc_actions/doc_ops into actions
      if (Array.isArray(rec.doc_actions)) {
        actions = [...(actions || []), ...(rec.doc_actions as DocAction[])];
      }
      if (Array.isArray(rec.ops)) actions = rec.ops as UnifiedAction[];
      if (Array.isArray(rec.doc_ops)) {
        actions = [...(actions || []), ...(rec.doc_ops as DocAction[])];
      }
      if (Array.isArray(obj)) actions = obj as UnifiedAction[];
      if (ans !== undefined || actions) return { answer_md: ans, actions } as Envelope;
    }
    return null;
  } catch { return null; }
}

// Hide any accidental tool/protocol JSON in assistant free-text
export function sanitizeAssistantText(s: string): string {
  if (!s) return '';
  let out = s;
  // Remove fenced code blocks that likely contain protocol JSON
  out = out.replace(/```(?:json)?\n[\s\S]*?(?:\"answer_md\"|\"actions\"|\"doc_actions\")[\s\S]*?```/gi, '').trim();
  // Remove bare JSON objects with protocol keys (best-effort)
  out = out.replace(/\{[\s\S]*?\}/g, (m) => {
    try {
      const obj = JSON.parse(m) as unknown;
      if (obj && typeof obj === 'object') {
        const rec = obj as Record<string, unknown>;
        if (typeof rec.answer_md === 'string' || Array.isArray(rec.actions) || Array.isArray(rec.doc_actions)) return '';
      }
      return m;
    } catch { return m; }
  });
  return out.trim();
}
