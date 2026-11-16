/**
 * CodeBuddy 客户端适配器。
 *
 * 抓包实证（2026-07-30, langfuse trace `d814929a67a1ca893c7b2b40c65ccd75`
 * session `f817ea40163c4dd89ee4f5a18bba9717`）：
 *
 *   - 协议：**OpenAI** (`/codebuddy/{spaceId}/v1/chat/completions`)，永远 stream
 *   - `message.content` 早期版本全是字符串；新版 CLI（2026-11-15 实测，
 *     session `01a1def2-…`）已改成 **text-block 数组**（Anthropic 形态，
 *     proxy log `role=user content=array[text]`）。数组直接走 default 兜底
 *     会把 `<system-reminder>` 等 wrapper 拼进头部，导致 mem-command parser
 *     的 `startsWith("mem:")` 判定失败 → 命令被透传给上游 LLM（P1：CodeBuddy
 *     下所有 mem: 命令失效）。修复：数组先拼 text block，再过一遍
 *     `extractUserQueryText`，与字符串路径同语义。
 *   - 字符串里塞了 CB pseudo-XML wrapper：
 *       * `<user_info>`         首条 user，OS/shell/workspace 元信息
 *       * `<additional_data>`   每条 user，current_time 等辅助段
 *       * `<user_query>...</user_query>`  **用户真实键入的锚点**
 *       * `<question_answer>` / `<title>` / `<questions>` / `<answers>`
 *                              session-init 表单回填
 *   - assistant message content 常是占位 `"-"`（LLM 只调工具没输出文本时）
 *   - **无 `cache_control` marker、无 fork/sidequery 概念** —— CC 那套三分法
 *     对 CB 完全不适用，所有请求都是 `main`
 *   - Tools 稳定 26 个（`list_dir` / `search_file` / `read_file` / `execute_command` …）
 *   - CB 特有 header：`x-agent-intent` / `x-conversation-id` /
 *     `x-conversation-message-id` / `x-conversation-request-id`
 *
 * 两个适配点：
 *   - `classifyRequest`: 恒 `"main"`（有抓包证据，不再是"stub 兜底"）
 *   - `extractUserText`: 走共用的 `extractUserQueryText`（优先取 `<user_query>`
 *     块；无则剥离 wrapper 后剩下的部分。跟 tdai L0 / mem-command 使用同一份
 *     语义，避免各处漂移）
 *
 * 详见 docs/design/2026-07-30-cc-request-routing-plan.md 附录（CodeBuddy 分析）。
 */

import { extractUserQueryText } from "../common/user-query-extractor.js";
import { defaultAdapter } from "./default.js";
import type { AgentAdapter } from "./types.js";

export const codebuddyAdapter: AgentAdapter = {
  agentKind: "codebuddy",

  classifyRequest(_body?, _path?, _headers?) {
    // 抓包实证：CB 请求无 cache_control marker、tools 稳定 26 个，没有 CC 的
    // fork/sidequery 分流特征。所有请求都是主对话，走完整 (injection + L0 + skill)。
    return "main";
  },

  extractUserText(content) {
    // 新版 CB CLI 用 text-block 数组（Anthropic 形态）：先拼接所有 text block，
    // 再走与字符串路径相同的 extractUserQueryText，保证 <user_query> 锚点/
    // wrapper 剥离语义一致。拼接结果为空或未知结构时仍回落 default 不崩。
    if (typeof content !== "string") {
      const joined = defaultAdapter.extractUserText(content);
      if (joined === null || joined.length === 0) return null;
      const extracted = extractUserQueryText(joined);
      return extracted.length > 0 ? extracted : null;
    }
    const extracted = extractUserQueryText(content);
    return extracted.length > 0 ? extracted : null;
  },
};
