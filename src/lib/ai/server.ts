import type { NextApiRequest } from "next";
import fs from "fs";
import path from "path";
import { APP_TITLE, getOpenRouterApiKey } from "@/lib/ai/config";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function buildOpenRouterHeaders(req: NextApiRequest): Record<string,string> {
  const key = getOpenRouterApiKey();
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": (req.headers.referer as string) || "",
    "X-Title": APP_TITLE,
  };
}

export function getOpenRouterLogger() {
  const logDir = path.join(process.cwd(), "logs");
  const logFile = path.join(logDir, "openrouter.log");
  const ensure = () => { try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch {} };
  return (entry: unknown) => {
    try { ensure(); fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf8" }); } catch {}
  };
}

// Independent agent log file (server-side). JSON lines for easy grep/ingest.
export function getAgentLogger() {
  const logDir = path.join(process.cwd(), "logs");
  const logFile = path.join(logDir, "agent.log");
  const ensure = () => { try { if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); } catch {} };
  return (entry: unknown) => {
    try { ensure(); fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", { encoding: "utf8" }); } catch {}
  };
}
