# Panova Agent 架构与调用流程

本文梳理前端对话 Dock、服务端 Agent、工具（tools）与 Prompt 的协作方式，并说明关键设计取舍与安全边界。

## 总览
- 前端：`src/components/ai/ChatDock.tsx` 构建消息，发送到服务端的 Agent 流式接口，渲染工具执行步骤，并将模型输出解析为结构化的“操作提议”卡片。
- 服务端 Agent：`src/pages/api/agent-stream.ts` 接收消息，调用 `src/lib/ai/agent.ts` 构建的 LangGraph Agent，与 OpenRouter（OpenAI 兼容）进行推理（统一使用流式接口）。
- 工具（Tools）：`src/lib/ai/tools.ts` 定义并集中注册了工具。当前 Agent 仅绑定“只读工具集”（reader-only），避免未经用户确认的写操作。
- 常量与类型聚合：
  - `src/lib/ai/actions.ts` 统一 action 常量（避免硬编码）、类型（FeatureAction/DocAction/Envelope）、以及特性状态的显示元数据（标签/样式）。
  - `src/lib/ai/tools-catalog.ts` 统一工具清单与中文标签（前后端共用，避免重复定义）。
  - `src/lib/ai/utils.ts` 聚合 Envelope 解析与自由文本净化工具。
- Prompt：`src/lib/ai/prompt.ts` 以 System 提示的形式约束输出协议（仅 JSON），并指导模型如需查询文档可调用只读工具。

## 端到端流程
1. 发送消息（前端）
   - 位置：`src/components/ai/ChatDock.tsx:258` 附近。
   - 组装消息：
    - `systemForJson()`：告知模型“只返回一个 JSON 对象”，并定义 `actions`（单一数组，包含 AIAction 与 DocAction 两类）。
     - `contextMsgForTree(nodes)`：注入“特性树最小快照”供模型理解当前上下文。
     - 历史对话与本次用户消息。
   - 发送：调用 `chatStream`（`src/lib/ai/client.ts`），POST 至 `/api/agent-stream`。

2. 服务端 Agent（流式）
   - 入口：`src/pages/api/agent-stream.ts`。
   - 构建请求头：`buildOpenRouterHeaders` 注入认证/Referer/Title（`src/lib/ai/server.ts`）。
   - 构建 Agent：`buildAgent(model, headers)`（`src/lib/ai/agent.ts`）。
     - 使用 `ChatOpenAI` 通过 OpenRouter 访问模型。
     - 绑定“只读工具集”（见下文）。
   - 执行：优先使用 `agent.streamEvents` 获取工具事件（`tool_start/tool_end/tool_error`）与模型 token；若不可用，回退为 `invoke` 一次性调用。
   - SSE 返回：将工具事件透传给前端；最终整合完整文本，按 OpenAI-like `choices[].delta.content` 发送最后一条，再 `[DONE]` 收尾。

3. 前端渲染与结构化提议
   - 位置：`src/components/ai/ChatDock.tsx:300-420`。
   - 工具事件：根据 `tool_start/tool_end/tool_error` 更新“工具执行”步骤与阶段文案。
   - 解析输出：优先解析为 Envelope（`answer_md`/`actions`），渲染为自然语言答案和统一的操作提议卡片；若解析失败，则净化后当作普通文本展示（前端不再进行二次补救调用）。
   - 用户确认与应用：
     - “应用/忽略”按钮已改为直接执行，无二次弹窗（统一复用同一组件处理）。
     - 操作落地：FeatureAction 直接更新特性树；DocAction 通过 atoms 调用服务器接口更新（均由用户点击触发）。

## 工具（Tools）与安全边界
- 定义位置：`src/lib/ai/tools.ts`。
- 工具清单：
  - 只读：`search_features`、`resolve_node`、`list_docs`、`get_doc`。
  - 写入：`create_doc`、`set_doc_title`、`set_doc_content`、`delete_doc`。
- 绑定策略（关键变更）：
  - Agent 现在仅绑定“只读工具集”（`buildReaderTools()`）：`src/lib/ai/agent.ts`。
  - 原因：与 `systemForJson()` 的协议保持一致——模型只输出 `actions`（含 DocAction）作为“待确认提议”，真正的写操作由用户在前端点击“应用”时执行，避免模型直接改数据。
  - 若未来需要让 Agent 具备自动落地写操作，可显式切换为 `buildTools()`（包含写工具），并相应调整前端策略。

## 常量、Schema 与 UI 映射的集中管理
- Action 字符串不再硬编码：使用 `FEATURE_ACTIONS` / `DOC_ACTIONS` 常量，减少拼写与分支遗漏风险。
- Feature 状态的标签/样式集中在 `FEATURE_STATUS_META` 中，前端 `statusBadge` 直接读取，避免重复样式定义。
- Prompt 示例与类型段落里的 action 值使用常量拼接，防止文档示例与实现不一致。
- Zod Schema：`src/lib/ai/schema.ts` 定义 Envelope/Action 的校验；前端解析 Envelope 后做一次轻量 `ZEnvelope.parse` 校验，失败则退回自然语言。

## Prompt 与常量/目录的动态同步
- 现状：`systemForJson()` 动态读取：
  - 只读工具列表来自 `src/lib/ai/tools-catalog.ts` 的 `READ_TOOL_NAMES`，自动拼入提示，不再硬编码。
  - Action 名称来自 `src/lib/ai/actions.ts` 的常量（`FEATURE_ACTIONS` / `DOC_ACTIONS`），示例与类型段落自动同步。
- 评估：工具权限的根源仍在服务端绑定（只读工具），Prompt 只作政策与 UX 提示；两者配合更稳健。
- 结论：数据来源统一，新增/更名工具或动作后无需更新多处文案，避免错漏。

## 关键文件索引
- Prompt 协议：`src/lib/ai/prompt.ts`
- Agent 构建：`src/lib/ai/agent.ts`
- 工具注册：`src/lib/ai/tools.ts`
- Agent API（流式）：`src/pages/api/agent-stream.ts`
- 客户端请求：`src/lib/ai/client.ts`
- 上下文注入/解析：`src/lib/ai/context.ts`
- 前端对话 UI：`src/components/ai/ChatDock.tsx`

## 常见问题与取舍
- 为什么不让 Agent 直接改文档？
  - 我们希望“AI 提议 → 用户确认 → 应用”，避免误改。只读工具 + 前端应用落地，带来可预期的安全边界。
- 为什么还保留写工具？
  - 便于未来支持“自动模式”或离线管道；但默认不绑定。
- Prompt 中点名工具的风险？
  - 主要是耦合度；不过当前也在工具层强化了安全策略（只读绑定），因此整体风险可控。

## 变更记录（本次）
- 将 Agent 绑定工具从“全量”改为“只读”：
  - `src/lib/ai/agent.ts` 使用 `buildReaderTools()`。
  - `src/lib/ai/tools.ts` 新增 `buildReaderTools()`，保留 `buildTools()` 供未来启用写工具时使用。
- 前端“应用/忽略”直接生效，移除二次确认弹窗（可按需恢复）。
- Prompt Agent 化重写：只读工具策略、输出协议、质量守则与示例同步常量。
- 清理冗余：移除 `/api/openrouter*` 与非流式 `/api/agent`，统一客户端仅使用 `/api/agent-stream`；删除前端结构化补救逻辑与确认弹窗状态。
- 聚合：新增 `src/lib/ai/actions.ts`（action 常量/类型/状态显示）、`src/lib/ai/tools-catalog.ts`（工具清单/标签）、`src/lib/ai/utils.ts`（Envelope 解析与净化）。

如需切换为“让 Agent 直接执行写操作”，请：
1) 把 `src/lib/ai/agent.ts` 中的 `buildReaderTools()` 改回 `buildTools()`；
2) 更新 `systemForJson()` 的相关措辞以避免冲突；
3) 考虑前端不再展示“待确认卡片”，而是改为显示执行结果。
