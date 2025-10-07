// LangGraph agent for proposing structured feature-tree actions.
// Tools are centralized in @/lib/ai/tools for easy maintenance.

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { getOpenRouterApiKey } from "@/lib/ai/config";
import { buildReaderTools } from "@/lib/ai/tools";

export function buildAgent(model: string, headers: Record<string, string>) {
  // Use OpenRouter API key as OpenAI apiKey for the SDK.
  const apiKey = getOpenRouterApiKey();
  // Avoid overriding Authorization set by the SDK; keep metadata headers.
  const { Authorization: _auth, ...rest } = headers;
  const llm = new ChatOpenAI({
    model,
    
    apiKey,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: rest,
    },
  });

  // Use reader-only toolset to avoid unintended writes; the model will emit doc_actions for user confirmation.
  const tools = buildReaderTools();
  const agent = createReactAgent({
    llm: llm.bindTools(tools, { parallel_tool_calls: true }),
    tools,
  });

  return agent;
}
// Ensure this module is server-only in Next.js bundling
import "server-only";
