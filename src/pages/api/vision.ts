import type { NextApiRequest, NextApiResponse } from "next";
import { buildOpenRouterHeaders, OPENROUTER_URL, getAgentLogger } from "@/lib/ai/server";

type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type LLMMessage = { role: string; content: string | Array<{ type: 'text'; text: string }> };

// Accepts base64 data URLs or http(s) URLs and calls a vision model via OpenRouter
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  try {
    const log = getAgentLogger();
    const { images = [] as { url: string }[], prompt = "请描述图片的关键要点。", model = "qwen/qwen3-vl-235b-a22b-instruct" } = req.body || {};
    if (!Array.isArray(images) || images.length === 0) return res.status(400).json({ error: "Missing images" });
    const reqId = `vision_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

    const headers = buildOpenRouterHeaders(req);
    const content: ChatContentPart[] = [{ type: "text", text: String(prompt || "") }];
    for (const it of images) {
      const url = String((it as { url: string })?.url || "");
      if (!url) continue;
      // Accept data URLs or remote URLs directly
      content.push({ type: "image_url", image_url: { url } });
    }
    const body = { model, messages: [{ role: "user", content }] } as const;
    try { log({ ts: new Date().toISOString(), kind: "vision_request", reqId, model, prompt, images: images.map(x => x?.url) }); } catch {}
    const resp = await fetch(OPENROUTER_URL, { method: "POST", headers, body: JSON.stringify(body) });
    const json = await resp.json();
    try { log({ ts: new Date().toISOString(), kind: "vision_response", reqId, status: resp.status, json }); } catch {}
    if (!resp.ok) return res.status(resp.status).json(json);
    const msg: LLMMessage | undefined = json?.choices?.[0]?.message;
    const text: string = (typeof msg?.content === "string")
      ? (msg?.content || "")
      : Array.isArray(msg?.content)
        ? (msg.content as Array<{ type: 'text'; text: string }>).map((x) => x?.text || "").join("\n").trim()
        : "";
    return res.status(200).json({ ok: true, text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
}
