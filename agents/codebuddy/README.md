# CodeBuddy (CB)

> agentSource: `codebuddy` | 协议: OpenAI Chat Completions / Anthropic Messages | Handler: `handler.ts` (共享)
>
> 本地历史导入 Memory Hub：见 [资产导入手册](./asset-import.md)。

---

## 1. 客户端接入配置

CB 通过**配置文件** `~/.codebuddy/models.json` 配置自定义模型：

```json
{
  "models": [
    {
      "id": "claude-sonnet-4-20250514",
      "name": "proxy-memory-agent",
      "vendor": "claude",
      "apiKey": "<业务用户的 sk-mem-... user_key>",
      "maxInputTokens": 200000,
      "url": "http://127.0.0.1:8096/codebuddy/default",
      "supportsToolCall": true,
      "supportsImages": true
    }
  ]
}
```

字段说明：
- `id` — Proxy 上游支持的模型 ID（如 `claude-sonnet-4-20250514`）
- `name` — 在 CodeBuddy 对话框中显示的名称，可自定义
- `vendor` — UI 展示用（如 `claude`、`openai`），不影响实际请求
- `apiKey` — 业务用户的 `user_key`（从面板获取，与 CC 的 `ANTHROPIC_AUTH_TOKEN` 相同）
- `url` — Proxy 地址 + `/codebuddy/<spaceId>`；`default` 是 memory 实例 ID

配置完成后在 CB 对话框中选择该模型即可。

### ⚠️ 版本限制

> CodeBuddy **4.10.2 ~ 4.10.4** 不携带 sessionId，无法完成 Session Init。  
> **请使用 ≥ 4.10.5 或 ≤ 4.10.1**。

请求路径：
- OpenAI: `POST /codebuddy/:spaceId/v1/chat/completions`
- Anthropic: `POST /codebuddy/:spaceId/v1/messages`

---

## 2. Session ID

| 优先级 | Header |
|--------|--------|
| 1 | `x-conversation-id` |
| 2 | `x-session-id` |
| 3 | `x-cb-session-id` |
| 4 | `x-codebuddy-session-id` |

CB IDE 插件会自动生成并携带 `x-conversation-id`。

---

## 3. Session Init（会话初始化 / Form）

### 3.1 机制

CB 使用 **`ask_followup_question`** function_call 发起交互式 Form：

- Tool name: `ask_followup_question`
- Call ID prefix: `call_session_init_` (OpenAI) / `toolu_session_init_` (Anthropic)
- 协议: OpenAI SSE tool_calls chunks 或 Anthropic SSE

### 3.2 状态机

```
asset_confirm → team_select → agent_task_select → initialized
```

4 步流程：
1. **asset_confirm** — 确认是否需要注入资产（"是否使用记忆/技能？"）
2. **team_select** — 选择团队
3. **agent_task_select** — 合并选择 Agent + Task
4. **initialized** — 注入资产，进入正常对话

### 3.3 分页

CB 的 `ask_followup_question` 选项列表 **无数量限制**，无需分页。  
所有选项一次性全部展示。

### 3.4 Form 能力（IDE 插件 vs CLI）

**CB IDE 插件**注册了 `ask_followup_question`，proxy 弹 form 即可完成选择。

**CB CLI 没有这个工具**（只有 `AskUserQuestion`），proxy 发的 form tool_call 会被
客户端回 `unsupported call: ask_followup_question`；proxy 匹配不到选项 → 连续
`maxRetries` → `bypassed=true`，团队资产与记忆**静默丢失**，且日志里只有
`asset-confirm max retries, abandoning`。

proxy 的判定（每次请求实时算，`pipeline/runners/openai-chat.ts`）：
`agentSource=codebuddy` 且 `body.tools[]` 非空且不含 `ask_followup_question`
→ 该请求视为**无 form UI**：

- 不走 `asset_confirm` / `team_select` / `agent_task` 任何表单
- 身份**只来自请求头预选**：`x-team-id` + `x-agent-id`（+ 可选 `x-task-id`）
- header 齐全且能对上是本人可见的 team/agent → 直接注册、注入资产
- header 缺失 / 对不上 → `bypassed`（不注入），后续请求头修好后自动重试注册

**可见性口径**：无 form 车道拉取的是 team **全量 active agent**，按
`owner == 自己 || visibility == team` 过滤（与 `session/user-default.ts` 一致）。
因此 CLI 的 `x-agent-id` 可以指向 team 内他人 owner 的公开 agent。
有 form 的 IDE 插件路径仍只展示自己 owner 的 agent（保持表单行为不变）。

> ⚠️ 若日志出现 `preset-partial (team resolved but agent missing/invalid)`：
> `x-team-id` 已命中，但 `x-agent-id` 不在该 team 的可见列表里 —— 多半是
> id 与 team 不匹配，或该 agent 是他人 owner 且 `visibility` 不是 `team`。
> 注意：bypass 会持久化在会话状态里，修好 header 后需**新开会话**
> （或在该会话执行 `mem:session-reset`）才会重新校验。

`body.tools` 为空或缺失（纯对话 / aux 请求）时不判定，保持既有行为。

> **CLI 用法**：给 CodeBuddy CLI 配 `CODEBUDDY_CUSTOM_HEADERS`（或在 settings.json
> 的 `env` 块里，键名须以 `CODEBUDDY_` 开头）携带
> `x-team-id` / `x-agent-id` / `x-task-id`（默认值，见 `config.example.yaml`
> `sessionInit.headerAutoSelect`；改了配置项 `teamHeader` / `agentHeader` /
> `taskHeader` 就按改后的名字发），
> 并确认 `sessionInit.headerAutoSelect.enabled: true`（默认开启）。
> 单独带 `x-task-id` 而不带 agent 仍会 bypass —— team 与 agent 是必填维度，
> task 是可选维度（只带 team 时没有 agent 表单可弹）。

### 3.4.1 CodeBuddy CLI（自定义 header）

**必须用换行分隔多个 header。逗号分隔会静默失效** —— CLI 把整串当成第一个
header 的值，后续 header 全部丢失：

```
# 错误 ❌
CODEBUDDY_CUSTOM_HEADERS="x-team-id: team-xxx,x-agent-id: agt-yyy"
→ proxy 收到 x-team-id = "team-xxx,x-agent-id: agt-yyy"
→ 未知 team → preset-mismatch → 静默 bypass（命令照常回答，但无记忆注入）

# 正确 ✅
CODEBUDDY_CUSTOM_HEADERS=$'x-team-id: team-xxx\nx-agent-id: agt-yyy'
```

shell / settings.json 两种写法（均已实测）：

```bash
# ~/.bashrc（换行用 $'...' 展开）
export CB_HDR_CODING=$'x-team-id: team-xxx\nx-agent-id: agt-yyy'
alias buddy_coding='CODEBUDDY_CUSTOM_HEADERS="$CB_HDR_CODING" codebuddy'
```

```jsonc
// settings.json —— JSON 字符串里用 \n 转义
{
  "env": {
    "CODEBUDDY_CUSTOM_HEADERS": "x-team-id: team-xxx\nx-agent-id: agt-yyy"
  }
}
```

`task_id` 语义：缺失或内核里不存在（如 `no-task`）不会阻断注册，只是回收范围
放宽到该 agent 的全部记忆；只有未知 team / 未知 agent 才算身份不匹配。

> **自检**：`deploy/global-images/smoke-codebuddy.sh [buddy_别名]` 会校验
> 别名/变量是否齐备、header 是否**逗号误用**、CLI 与 proxy 模型是否可用，
> 并跑一次真实请求断言 proxy 日志里走到 `formToolMissing … preset hit →
> register directly`（而非静默 bypass）。

### 3.5 跳过 Session Init

- 在 `asset_confirm` 步骤选择 "否" → 跳过所有后续步骤，直接透传
- 自由文本 `跳过` / `skip` **不会**触发跳过：`SKIP_RE` 已于 2026-09-21 删除
  （客户端会回放问题原文，正则误命中导致整个 session 被误 bypass）。
  现在只识别 form 里"否"这个精确选项；答非所问时由 `maxRetries` 兜底 bypass。
- CLI（无 form UI，见 §3.4）：不带 header 或 header 不匹配即 bypass。

---

## 4. 请求分类

CB 的请求分类较简单：

| 类型 | 说明 |
|------|------|
| **main** | 所有请求默认都是 main |

CB **没有** fork / sidequery / compact 等辅助请求概念。每条请求都走完整链路。

---

## 5. 用户文本提取

CB 消息体 `message.content`：
- **IDE 插件**：纯字符串（不是 content block 数组）
- **CLI（≥ 2026-11）**：text-block 数组（Anthropic 形态），proxy 先拼 text block
  再走同一套提取逻辑（`agent-adapters/codebuddy.ts`）


提取逻辑：
1. 在字符串中查找 `<user_query>...</user_query>` XML 包裹
2. 若找到 → 提取内部文本
3. 若未找到 → 整个字符串作为用户文本
4. 剥离 CB 伪 XML 标签 (`<agent_context>`, `<code_context>` 等)

---

## 6. 注入 Profile

**XML 结构**的 system prompt 注入：

```xml
<agent_skills>
  <available_skills>...</available_skills>
</agent_skills>
<content_policy>...</content_policy>
<user_memory>...</user_memory>
<session_context>...</session_context>
```

注入点：
- OpenAI: `messages[0].content`（system message 字符串内追加）
- Anthropic: `system` 字段

---

## 7. 特殊行为

- **独特 Header 集**: `x-agent-intent`, `x-conversation-message-id`, `x-conversation-request-id`
- **Assistant placeholder**: CB assistant 消息可能是 `"-"` 占位（空回复标记）
- **共享 Handler**: dsh 也复用此 handler (`handleChatCompletions`)
- **双协议支持**: 同一 CB 版本可能走 OpenAI 或 Anthropic 协议，handler 自动适配

---

## 8. 归档触发

- 对话超过阈值自动触发 `skill/conversation/add`
- 支持 `skill/conversation/force-archive`
- 归档数据写入 L0

---

## 9. 环境变量

无 CB 专属变量。使用全局 proxy 配置：

```env
PROXY_PORT=8096
FORWARD_URL=https://api.openai.com   # CB OpenAI 上游
# 或 FORWARD_URL=https://api.anthropic.com  # CB Anthropic 上游
```

身份预选用的 header 名不在这里，在 `sessionInit.headerAutoSelect`
（`teamHeader` / `agentHeader` / `taskHeader`，默认 `x-team-id` / `x-agent-id` /
`x-task-id`，见 `config.example.yaml`）。

实际上游由 `resolveForwardTarget` 动态决定（tokenhub / 直连 provider）。

---

## 10. 常见问题

**Q: CB 和 CC 的主要区别是什么？**  
A: 协议不同（OpenAI vs Anthropic）、内容结构不同（string vs content-block array）、无辅助请求分类、选项无分页。

**Q: CB 的 `<user_query>` 包裹是谁加的？**  
A: CB IDE 插件客户端在发送前自动包裹用户原文，proxy 提取时剥离。

**Q: CB 走 Anthropic 协议时和 CC 有什么区别？**  
A: form tool name 不同 (`ask_followup_question` vs `AskUserQuestion`)，content 仍是 string 格式，注入用 XML 而非 Markdown。agentSource 标记不同。
