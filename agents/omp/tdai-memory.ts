/**
 * TDAI Memory Proxy provider for omp (a Pi fork) — port of MemoryCore/pi-plugin.
 *
 *   1. register a `tdai` provider pointing at the proxy   (pi.registerProvider)
 *   2. tag each request with a per-process conversation id
 *
 * All memory capability (L3 persona / L2 scene injection, L0 capture,
 * L0-L2 search) is delivered server-side by the proxy. This extension owns
 * provider routing and the per-session conversation id only.
 *
 * Difference from the Pi plugin: omp has no `before_provider_headers` event and
 * a registered provider's headers are static, so the per-request conversation
 * id travels as a `[tdai-conversation-id:...]` prefix on the first user
 * message; the proxy parses it (resolveConversationIdFromBody).
 *
 * Config is env-only:
 *   TDAI_TEAM_ID      (required)  panel -> Team
 *   TDAI_AGENT_ID     (required)  panel -> Agent
 *   TDAI_USER_KEY     (required)  panel -> API Key (NOT the admin/gateway key)
 *   TDAI_PROXY_URL       default http://127.0.0.1:8096
 *   TDAI_SPACE_ID        default "default"
 *   TDAI_AGENT_SOURCE    default "omp"
 *   TDAI_TASK_ID         optional, narrows recall to one task
 *   TDAI_MODEL           default "deepseek/deepseek-flash"
 */

const proxyBase = process.env.TDAI_PROXY_URL ?? "http://127.0.0.1:8096";
const spaceId = process.env.TDAI_SPACE_ID ?? "default";
const agentSource = process.env.TDAI_AGENT_SOURCE ?? "omp";
const model = process.env.TDAI_MODEL ?? "deepseek/deepseek-flash";
const userKey = process.env.TDAI_USER_KEY ?? "";
const teamId = process.env.TDAI_TEAM_ID ?? "";
const agentId = process.env.TDAI_AGENT_ID ?? "";
const taskId = process.env.TDAI_TASK_ID ?? "";

// Mirrors the Pi plugin: missing identity vars warn and skip registration so
// omp still starts (a broken startup extension must not block the CLI).
const required = { TDAI_USER_KEY: userKey, TDAI_TEAM_ID: teamId, TDAI_AGENT_ID: agentId };
const missing = Object.keys(required).filter((k) => !required[k]);

export default function (pi) {
	if (missing.length > 0) {
		console.warn(
			`[tdai-memory] Not registering the TDAI provider: missing required env var(s): ${missing.join(", ")}. ` +
				`Set TDAI_USER_KEY, TDAI_TEAM_ID, TDAI_AGENT_ID. TDAI_TASK_ID is optional.`,
		);
		return;
	}

	const headers = { "x-team-id": teamId, "x-agent-id": agentId };
	// Omit x-task-id when unset: the proxy then registers from team+agent
	// alone (broad recall) instead of failing on a task it cannot resolve.
	if (taskId) headers["x-task-id"] = taskId;

	// baseUrl MUST include /v1: the openai-completions provider appends
	// /chat/completions but does not insert /v1 on its own.
	pi.registerProvider("tdai", {
		name: "TDAI Memory Proxy",
		baseUrl: `${proxyBase}/${agentSource}/${spaceId}/v1`,
		api: "openai-completions",
		apiKey: userKey,
		headers,
		models: [
			{
				id: model,
				name: model,
				input: ["text", "image"],
				reasoning: true,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 524288,
				maxTokens: 8192,
			},
		],
	});

	// One session id per omp process (omp resolves a fresh id on switch/fork).
	// The id keys memory + task binding on the proxy, so use a CSPRNG — the
	// marker travels in the first user message, not a header.
	const newConversationId = () => `omp-${crypto.randomUUID()}`;
	let conversationId = newConversationId();
	const resetSession = () => {
		conversationId = newConversationId();
	};
	pi.on("session_switch", resetSession);
	pi.on("session_branch", resetSession);

	const MARKER_LINE_RE = /^\[tdai-conversation-id:[^\]\n]*\]\n?/;
	const LEADING_MARKERS_RE = /^(?:\[tdai-conversation-id:[^\]\n]*\]\n?)+/;

	// `before_provider_request` can only replace the body, so prepend the marker
	// to the first user message. The proxy reads it as the conversation id
	// (resolveConversationIdFromBody) when no header carries one.
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== "tdai") return undefined;
		if (typeof event.payload !== "object" || event.payload === null) return undefined;
		const payload = { ...(event.payload as Record<string, unknown>) };
		const messages = Array.isArray(payload.messages) ? [...(payload.messages as unknown[])] : null;
		if (!messages) return payload;
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i] as { role?: string; content?: unknown };
			if (m?.role !== "user") continue;
			const marker = `[tdai-conversation-id:${conversationId}]\n`;
			if (typeof m.content === "string") {
				// Always re-tag: a marker the user typed is dropped, so the real id wins.
				messages[i] = { ...m, content: marker + m.content.replace(LEADING_MARKERS_RE, "") };
			} else if (Array.isArray(m.content) && m.content.length > 0) {
				// omp sends text as array parts (system-reminder blocks first), so the
				// marker has to ride on the first *text* part, not on .content itself.
				const parts = m.content as Array<Record<string, unknown>>;
				const next = [...parts];
				const idx = next.findIndex((p) => p?.type === "text" && typeof p.text === "string");
				if (idx < 0) {
					next.unshift({ type: "text", text: marker.trimEnd() });
				} else {
					next[idx] = {
						...next[idx],
						text: marker + (next[idx].text as string).replace(LEADING_MARKERS_RE, ""),
					};
				}
				messages[i] = { ...m, content: next };
			}
			break;
		}
		payload.messages = messages;
		return payload;
	});

	// Keep the marker out of anything the user reads back (tool output, transcripts).
	pi.on("tool_result", (event) => {
		const content = (event as { content?: unknown }).content;
		if (typeof content !== "string" || !content.includes("[tdai-conversation-id:")) return undefined;
		return { content: content.replace(MARKER_LINE_RE, "") };
	});
}
