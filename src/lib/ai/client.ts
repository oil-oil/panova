import { DEFAULT_MODEL } from "@/lib/ai/config";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// Stream chat via SSE transported over fetch body.
export async function chatStream(params: {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onEvent?: (evt: unknown) => void; // tool_start/tool_end/tool_error... pass-through
}): Promise<{ full: string; status: number }> {
  const { messages, model = DEFAULT_MODEL, signal, onDelta, onEvent } = params;
  const resp = await fetch('/api/agent-stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`网络错误 ${resp.status}${txt ? `: ${txt.slice(0,120)}` : ''}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  const applyDelta = (d: string) => { if (!d) return; full += d; if (onDelta) { try { onDelta(d); } catch {} } };
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 2);
      const lines = raw.split("\n");
      for (const line of lines) {
        const m = line.match(/^data:\s*(.*)$/); if (!m) continue;
        const payload = m[1]; if (payload === "[DONE]") { try { reader.cancel(); } catch {} break; }
        try {
          const json = JSON.parse(payload);
          if (json && typeof json === 'object' && (json.type || json.event)) {
            try { if (onEvent) onEvent(json); } catch {}
          }
          const d = json?.choices?.[0]?.delta?.content ?? '';
          if (d) applyDelta(d);
        } catch {}
      }
    }
  }
  return { full, status: resp.status };
}
