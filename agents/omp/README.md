# TDAI Memory for omp

OMP ([oh-my-pi](https://omp.sh), a Pi fork) is a header-preselect agent source:
the proxy identifies the team/agent from request headers and never shows a
picker form. This directory has the two pieces that make omp work.

## 1. Client env (the CLI variables)

OMP reads `.env` in this order (first non-empty wins): shell env → `$PWD/.env` →
`~/.omp/agent/.env` → `~/.omp/.env` → `~/.env`. Set them once in
`~/.omp/agent/.env`:

```bash
# required
TDAI_TEAM_ID=<team-id>          # panel -> Team
TDAI_AGENT_ID=<agent-id>        # panel -> Agent, and it must sit in an upstream group
TDAI_USER_KEY=<user-api-key>    # panel -> API Key (NOT the admin/gateway key)

# required for omp (this is the whole point)
TDAI_AGENT_SOURCE=omp           # URL path segment -> /omp/<spaceId>/v1/chat/completions

# optional
TDAI_PROXY_URL=http://127.0.0.1:8096
TDAI_SPACE_ID=default
TDAI_MODEL=deepseek/deepseek-flash     # must match a model the proxy forwards
TDAI_TASK_ID=                           # omit for broad recall
```

The extension registers exactly one model, `<TDAI_MODEL>` under the `tdai`
provider. Make it the default so every session is captured, with the direct
provider as the fallback when the proxy is down:

```yaml
# ~/.omp/agent/config.yml
modelRoles:
   default: tdai/deepseek/deepseek-flash:max
retry:
   fallbackChains:
      default:
         - deepseek/deepseek-flash:max
```

One-shot alternative without touching settings: `omp --model tdai/deepseek/deepseek-flash`.

## 2. Provider shim (`~/.omp/agent/extensions/tdai-memory.ts`)

The shim ships in this directory: copy [`tdai-memory.ts`](./tdai-memory.ts) to
`~/.omp/agent/extensions/`. OMP loads every file there at startup.

OMP has no `before_provider_headers` event (that is Pi-only) and a registered
provider's headers are static, so the conversation id cannot travel as a header.
Instead the shim's `before_provider_request` hook prefixes the first user
message with `[tdai-conversation-id:<id>]` and the proxy parses that marker
(`resolveConversationIdFromBody` in `MemoryProxy/src/session/session-key.ts`)
when no `x-conversation-id` header is present. A header always wins, and every
other agent source is unaffected because the marker is only read as a fallback.

`TDAI_USER_KEY` must be non-empty in `~/.omp/agent/.env`. A shell-only export
does not always reach the extension's process; with an empty key the request
arrives unauthenticated, the proxy logs `conversationId=null`, and no memory is
injected.

Note: omp lets the model keep thinking across short output caps, so a small
`max_tokens` shows up as an empty `content` with only `reasoning` filled — that
is the model, not the proxy.

## 3. Rebuild matrix

Adding `omp` touches two images, not one:

| Component | What changes | Rebuild + restart |
| --- | --- | --- |
| Proxy | `HEADER_ONLY_AGENTS`, `extractSpaceIdFromPath`, adapter/strategy/profile | `cd MemoryProxy && docker build -t memory-proxy:en .` then `./deploy/global-images/start-proxy.sh` |
| memory-core | `DEFAULT_SUPPORTED_AGENTS_FALLBACK` (`MemoryCore/src/metadata/default-supported-agents.ts`) — the list the panel validates group membership against and the seed source for the default group | `cd MemoryCore && DOCKER_BUILDKIT=1 docker build -t memory-core:en .` then point `MEMORY_CORE_IMAGE` at it and `./deploy/global-images/start-memory-core.sh` |

No manual panel edit is needed: after memory-core restarts, the first
`groups/list` / `upstream/supported-agents` call runs the scheme-E
diff-append (`_syncDefaultAgentsWithSnapshot`), which appends `omp` to the
default group's `agents` and `supported_agents_snapshot`. The proxy caches the
group list for 30 s, so wait (or restart the proxy) before retrying omp.

## 4. Server prerequisites

- `omp` must be in `HEADER_ONLY_AGENTS` (`MemoryProxy/src/session/preset.ts`) —
  otherwise the proxy tries to render an `ask_followup_question` form omp does
  not have, and the session gets bypassed (no team assets, no memory).
- `omp` must be in `extractSpaceIdFromPath` (`MemoryProxy/src/credit-reporter.ts`)
  — otherwise auth rejects with `missing service_id (spaceId not in request path)`.
- On managed instances the agent's `omp` source must be in an upstream group in
  Panel; unmanaged agents get `400 AGENT_NOT_CONFIGURED`.

## 5. Verify

```bash
docker logs tdai-proxy --tail 40 2>&1 | grep -E "agentSource=omp|register directly|write-l0"
```

Expect `conversationId=omp-…` (not `null`), `injectedSkipped=false`, and a
`register directly` line with your team/agent. `session-init ... → bypass` means
the team/agent ids did not match; `conversationId=null` means `TDAI_USER_KEY` was
empty in the extension's process or the marker was not attached.

Upstream `502 provider closed the stream before sending a completion marker` is a
different failure: the proxy forwards and the *provider* drops the stream. That
comes from the upstream (e.g. bifrost → deepseek) and retries on its own.
