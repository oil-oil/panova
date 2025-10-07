import type { NextApiRequest, NextApiResponse } from "next";
import { DEFAULT_MODEL } from "@/lib/ai/config";
import { buildOpenRouterHeaders, getAgentLogger } from "@/lib/ai/server";
import { buildAgent } from "@/lib/ai/agent";
import type { ChatMessage } from "@/types/ai";

// For initial integration we send a single SSE chunk with the full content and then [DONE].
// This keeps the client-side stream parser compatible without token-by-token streaming complexity.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  const log = getAgentLogger();
  try {
    const { model = DEFAULT_MODEL, messages = [] as ChatMessage[], threadId }: { model?: string; messages?: ChatMessage[]; threadId?: string } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing messages" });
    }
    let headers: Record<string, string>;
    try { headers = buildOpenRouterHeaders(req); } catch (e) { return res.status(500).json({ error: (e as Error).message }); }

    const agent = buildAgent(model, headers);
    const ts = new Date().toISOString();
    const reqId = `ag_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    // Detailed request log: include full messages for audit
    log({ ts, kind: "agent_request", reqId, model, threadId, messages });

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    let full = "";
    try {
      // Use a minimal structural typing to avoid 'any'
      const streamer = agent as unknown as { streamEvents: (args: { messages: ChatMessage[] }, cfg: { recursionLimit: number; configurable?: Record<string, unknown>; version?: string }) => Promise<AsyncIterable<unknown>> };
      const stream = await streamer.streamEvents({ messages }, {
        recursionLimit: 12,
        configurable: threadId ? { thread_id: String(threadId) } : undefined,
        version: "v2",
      });
      let modelStarted = false;
      for await (const ev of stream) {
        const obj = ev as Record<string, unknown>;
        const etype = String((obj.event ?? obj.type) || "");
        // Tool start/end/error
        if (etype.includes("tool_start")) {
          const data = (obj.data ?? {}) as Record<string, unknown>;
          const name = String(obj.name ?? data.name ?? "tool");
          const input = (data.input ?? null) as unknown;
          const runId = (obj as Record<string, unknown>).run_id ?? (obj as Record<string, unknown>).id;
          const callIdRaw = (data as Record<string, unknown>).id ?? (data as Record<string, unknown>).tool_call_id ?? runId;
          const call_id = typeof callIdRaw === 'string' ? callIdRaw : String(callIdRaw ?? '');
          // Log detailed tool start
          try { log({ ts: new Date().toISOString(), kind: "tool_start", reqId, call_id, name, input }); } catch {}
          res.write(`data: ${JSON.stringify({ type: "tool_start", name, input, call_id })}\n\n`);
        } else if (etype.includes("tool_end")) {
          const data = (obj.data ?? {}) as Record<string, unknown>;
          const name = String(obj.name ?? data.name ?? "tool");
          const output = (data as Record<string, unknown>).output ?? (data as Record<string, unknown>).output_text ?? null;
          const runId = (obj as Record<string, unknown>).run_id ?? (obj as Record<string, unknown>).id;
          const callIdRaw = (data as Record<string, unknown>).id ?? (data as Record<string, unknown>).tool_call_id ?? runId;
          const call_id = typeof callIdRaw === 'string' ? callIdRaw : String(callIdRaw ?? '');
          try { log({ ts: new Date().toISOString(), kind: "tool_end", reqId, call_id, name, output }); } catch {}
          res.write(`data: ${JSON.stringify({ type: "tool_end", name, output, call_id })}\n\n`);
        } else if (etype.includes("tool_error") || etype.includes("chain_error")) {
          const data = (obj.data ?? {}) as Record<string, unknown>;
          const name = String(obj.name ?? data.name ?? "tool");
          const error = data;
          const runId = (obj as Record<string, unknown>).run_id ?? (obj as Record<string, unknown>).id;
          const callIdRaw = (data as Record<string, unknown>).id ?? (data as Record<string, unknown>).tool_call_id ?? runId;
          const call_id = typeof callIdRaw === 'string' ? callIdRaw : String(callIdRaw ?? '');
          try { log({ ts: new Date().toISOString(), kind: "tool_error", reqId, call_id, name, error }); } catch {}
          res.write(`data: ${JSON.stringify({ type: "tool_error", name, error, call_id })}\n\n`);
        }
        // Model token stream
        if (etype.includes("chat_model_stream")) {
          if (!modelStarted) { try { log({ ts: new Date().toISOString(), kind: "model_stream_start", reqId, model }); } catch {} modelStarted = true; }
          const data = (obj.data ?? {}) as Record<string, unknown>;
          const chunk = (data as Record<string, unknown>).chunk as Record<string, unknown> | undefined;
          const token = (chunk?.content as string) || (chunk?.message as Record<string, unknown> | undefined)?.content as string || "";
          if (token) full += token;
        } else if (etype.includes("chat_model_end")) {
          const data = (obj.data ?? {}) as Record<string, unknown>;
          const out = (data as Record<string, unknown>).output_text as string || "";
          if (out) full += out;
        }
      }
    } catch (e) {
      // In case streamEvents is unavailable, fallback to single invoke
      try {
        const invoker = agent as unknown as { invoke: (args: { messages: ChatMessage[] }, cfg: { recursionLimit: number; configurable?: Record<string, unknown> }) => Promise<{ content?: string }> };
        const ai = await invoker.invoke({ messages }, {
          recursionLimit: 12,
          configurable: threadId ? { thread_id: String(threadId) } : undefined,
        });
        full = ai?.content ?? "";
        try { log({ ts: new Date().toISOString(), kind: "agent_invoke_response", reqId, model, content: full, length: full?.length || 0 }); } catch {}
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log({ ts: new Date().toISOString(), kind: "agent_error(stream)", reqId, message: msg });
      }
    }

    // Emit final OpenAI-like delta chunk for compatibility
    const payload = { choices: [{ delta: { content: full }, finish_reason: "stop" }] };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    // Detailed response log
    try { log({ ts: new Date().toISOString(), kind: "agent_response", reqId, model, content: full, length: full?.length || 0 }); } catch {}
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { log({ ts: new Date().toISOString(), kind: "agent_error(stream)", message: msg }); } catch {}
    if (!res.headersSent) return res.status(500).json({ error: msg });
    try { res.end(); } catch {}
  }
}
