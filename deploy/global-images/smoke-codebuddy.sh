#!/usr/bin/env bash
# CodeBuddy CLI + TDAI memory proxy 冒烟测试。
#
# 覆盖三件事：
#   1. ~/.bashrc 里的别名/环境变量是否齐备且**格式正确**
#   2. codebuddy CLI 与 ~/.codebuddy/models.json 的 proxy 模型是否可用
#   3. 端到端：一次真实 `-p` 调用后，proxy 日志里是否真的走到
#      「formToolMissing → preset hit → register directly」（无 form 车道），
#      而**不是**静默 bypass。
#
# 用法：
#   ./smoke-codebuddy.sh              # 默认用第一个 buddy_* 别名
#   ./smoke-codebuddy.sh buddy_legal  # 指定别名
#   ./smoke-codebuddy.sh --list       # 列出发现的别名
#
# 全部通过 → exit 0；有 FAIL → exit 1。
#
# 为什么要校验 header 格式：CODEBUDDY_CUSTOM_HEADERS 只认**换行**分隔。
# 写成逗号分隔（`x-team-id: a,x-agent-id: b`）时 CLI 会把整串当成 x-team-id 的值
# → 未知 team → preset-mismatch → 静默 bypass。CLI 依然正常回答，所以不测
# 日志根本发现不了（2026-11-16 实测）。

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "$SCRIPT_DIR/_lib.sh"

PASS=0
FAIL=0
SKIP=0
ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$*"; }
skip() { SKIP=$((SKIP + 1)); printf '  \033[33m-\033[0m %s\n' "$*"; }
sec()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# 读用户的交互式 shell 变量/别名。bash -ic 会往 stderr 打 job-control 噪音，丢掉。
sh_get() { bash -ic "$1" 2>/dev/null; }

BASHRC="$HOME/.bashrc"
MODELS="$HOME/.codebuddy/models.json"
CONTAINER="tdai-proxy"
ALIAS=""

for arg in "$@"; do
  case "$arg" in
    --help|-h) sed -n '2,22p' "$0"; exit 0 ;;
    --list)
      sh_get "alias" | sed -n 's/^alias \(buddy_[A-Za-z0-9_]*\)=.*/  \1/p'
      exit 0
      ;;
    -*) warn "未知参数: ${arg}（忽略）" ;;
    *) ALIAS="$arg" ;;
  esac
done

# 默认取 .bashrc 里第一个 buddy_* 别名
if [[ -z "$ALIAS" ]]; then
  ALIAS="$(sh_get "alias" | sed -n 's/^alias \(buddy_[A-Za-z0-9_]*\)=.*/\1/p' | head -1)"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "1. ~/.bashrc 别名与环境变量"
# ─────────────────────────────────────────────────────────────────────────────
if [[ ! -f "$BASHRC" ]]; then
  bad "$BASHRC 不存在"
else
  ok "$BASHRC 存在"
  grep -qE '^export CODEBUDDY_API_KEY=' "$BASHRC" \
    && ok "CODEBUDDY_API_KEY 已导出（跳过 Tencent 登录闸门）" \
    || bad "缺少 export CODEBUDDY_API_KEY=...（CLI 会卡登录）"

  hdr_vars=$(grep -cE '^export CB_HDR_[A-Z0-9_]+=' "$BASHRC")
  if (( hdr_vars > 0 )); then
    ok "找到 $hdr_vars 个 CB_HDR_* 身份变量"
  else
    bad "缺少 export CB_HDR_*=...(x-team-id/x-agent-id 请求头)"
  fi

  al=$(grep -cE '^alias buddy_[A-Za-z0-9_]+=' "$BASHRC")
  if (( al > 0 )); then
    ok "找到 $al 个 buddy_* 别名"
  else
    bad "缺少 alias buddy_*='CODEBUDDY_CUSTOM_HEADERS=... codebuddy'"
  fi

  # 别名必须真的把 CB_HDR_* 喂给 CODEBUDDY_CUSTOM_HEADERS
  if grep -qE "^alias ${ALIAS:-buddy_[A-Za-z0-9_]+}=.*CODEBUDDY_CUSTOM_HEADERS=" "$BASHRC"; then
    ok "${ALIAS:-buddy_*} 别名会把 CB_HDR_* 传给 CODEBUDDY_CUSTOM_HEADERS"
  else
    bad "${ALIAS:-buddy_*} 别名没有传 CODEBUDDY_CUSTOM_HEADERS（身份不会到达 proxy）"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "2. 身份请求头内容（格式与名字）"
# ─────────────────────────────────────────────────────────────────────────────
PROXY_CONFIG="$SCRIPT_DIR/.proxy-config/config.yaml"
# proxy 实际读的 header 名（改过配置就以配置为准）
TEAM_HDR=$(sed -n 's/^ *teamHeader: *"\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' "$PROXY_CONFIG" 2>/dev/null | head -1)
AGENT_HDR=$(sed -n 's/^ *agentHeader: *"\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' "$PROXY_CONFIG" 2>/dev/null | head -1)
TEAM_HDR=${TEAM_HDR:-x-team-id}
AGENT_HDR=${AGENT_HDR:-x-agent-id}
[[ -f "$PROXY_CONFIG" ]] && ok "读到 proxy header 配置（$TEAM_HDR / $AGENT_HDR）" \
                         || skip "未找到 $PROXY_CONFIG，按默认 $TEAM_HDR / $AGENT_HDR 校验"

if [[ -z "$ALIAS" ]]; then
  bad "没有可用的 buddy_* 别名，跳过请求头检查"
else
  CB_ALIAS="$ALIAS"
  HDR_VAR=$(grep -E "^alias $CB_ALIAS=" "$BASHRC" | sed -n 's/.*CODEBUDDY_CUSTOM_HEADERS="\$\([A-Za-z0-9_]*\)".*/\1/p')
  if [[ -z "$HDR_VAR" ]]; then
    bad "无法从别名解析出 CB_HDR_* 变量名"
  else
    ok "别名 $CB_ALIAS 使用 \$$HDR_VAR"
    HDR_VALUE=$(sh_get "printf '%s' \"\$$HDR_VAR\"")
    if [[ -z "$HDR_VALUE" ]]; then
      bad "\$$HDR_VAR 为空"
    else
      # 逗号分隔会让 CLI 把整串塞进第一个 header → 未知 team → 静默 bypass
      if [[ "$HDR_VALUE" == *,* ]]; then
        bad "\$$HDR_VAR 用了逗号分隔 —— CLI 只认换行，逗号会把后面的 header 吞进第一个值"
        printf '      实际会发出的 ${TEAM_HDR} = %s\n' "${HDR_VALUE%%,*},..."
      else
        ok "\$$HDR_VAR 用换行分隔（CLI 认这个格式）"
      fi

      printf '%s\n' "$HDR_VALUE" | grep -qE "^${TEAM_HDR}: *[^ ]" \
        && ok "含 ${TEAM_HDR}（非空）" \
        || bad "缺 ${TEAM_HDR}（proxy 判定 no-preset-headers → bypass）"
      printf '%s\n' "$HDR_VALUE" | grep -qE "^${AGENT_HDR}: *[^ ]" \
        && ok "含 ${AGENT_HDR}（非空）" \
        || bad "缺 ${AGENT_HDR}（只有 team 时无 form 可弹 → bypass）"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "3. codebuddy CLI 与 proxy 模型"
# ─────────────────────────────────────────────────────────────────────────────
if ! command -v codebuddy >/dev/null 2>&1 && [[ -z "$(sh_get 'command -v codebuddy')" ]]; then
  bad "codebuddy 不在 PATH"
else
  ok "codebuddy → $(sh_get 'command -v codebuddy' || command -v codebuddy)"
  ver=$(codebuddy --version 2>/dev/null | head -1)
  [[ -n "$ver" ]] && ok "版本 $ver" || bad "codebuddy --version 无输出"
fi

PROXY_PORT=$(sed -n 's/^ *port: *\([0-9]*\).*/\1/p' "$PROXY_CONFIG" 2>/dev/null | head -1)
PROXY_PORT=${PROXY_PORT:-8096}

if [[ ! -f "$MODELS" ]]; then
  bad "$MODELS 不存在（CLI 没有 proxy 模型可选）"
else
  # 找出 url 指向本机 proxy 的那个模型 id
  PROXY_MODEL=$(python3 - "$MODELS" "$PROXY_PORT" <<'PY' 2>/dev/null
import json, sys
path, port = sys.argv[1], sys.argv[2]
for m in json.load(open(path)).get("models", []):
    u = str(m.get("url", ""))
    if f"127.0.0.1:{port}/" in u or f"localhost:{port}/" in u:
        if "/codebuddy/" in u:
            print(m["id"]); break
PY
)
  if [[ -n "$PROXY_MODEL" ]]; then
    ok "proxy 模型 id = $PROXY_MODEL"
  else
    bad "$MODELS 里没有指向 127.0.0.1:${PROXY_PORT}/codebuddy/ 的模型（请求不会经过 proxy）"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "4. proxy 健康与新鲜度"
# ─────────────────────────────────────────────────────────────────────────────
code=$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROXY_PORT}/health" 2>/dev/null)
[[ "$code" == "200" ]] && ok "GET /health → 200" || bad "GET /health → ${code:-无响应}（proxy 没起来？）"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  ok "容器 $CONTAINER 运行中"
  # 容器里的代码是否等于工作树（stale 镜像会让所有结论失效）
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  stale=0
  for f in src/pipeline/runners/openai-chat.ts src/session/codebuddy/init.ts; do
    h=$(md5sum "$REPO_ROOT/MemoryProxy/$f" 2>/dev/null | cut -d' ' -f1)
    c=$(docker exec "$CONTAINER" md5sum "/app/$f" 2>/dev/null | cut -d' ' -f1)
    [[ -n "$h" && -n "$c" && "$h" != "$c" ]] && stale=1
  done
  if (( stale )); then
    bad "容器代码与工作树不一致（stale 镜像）—— 先 docker build -t memory-proxy:en ."
  else
    ok "容器代码与工作树一致"
  fi
else
  skip "容器 $CONTAINER 未运行，跳过新鲜度检查"
fi

# ─────────────────────────────────────────────────────────────────────────────
sec "5. 端到端（真实请求 + 日志断言）"
# ─────────────────────────────────────────────────────────────────────────────
if [[ -z "${CB_ALIAS:-}" || -z "${PROXY_MODEL:-}" ]]; then
  bad "前置条件不足（缺别名或 proxy 模型），跳过端到端"
else
  SID="smoke-$(date +%s)"
  OUT=$(mktemp)
  # `--session-id` 给这次调用一个可 grep 的会话键
  timeout 120 bash -ic "$CB_ALIAS -p --model $PROXY_MODEL --session-id $SID 'Reply with exactly: PONG'" >"$OUT" 2>&1
  rc=$?
  if (( rc == 0 )) && grep -q "PONG" "$OUT"; then
    ok "CLI 返回正常（exit 0，含 PONG）"
  else
    bad "CLI 调用失败（exit=$rc）: $(tail -2 "$OUT" | tr '\n' ' ' | cut -c1-160)"
  fi

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    LOG=$(docker logs --since 5m "$CONTAINER" 2>&1 | grep -F "$SID")
    if [[ -z "$LOG" ]]; then
      bad "proxy 日志里没有 session=$SID —— 请求没走 proxy（模型或 base url 不对）"
    else
      ok "proxy 收到了该会话"

      grep -qE "unsupported call|ask_followup_question.*unsupported" <<<"$LOG" \
        && bad "客户端回了 unsupported call（form 工具残留）" \
        || ok "没有 form 工具报错"

      grep -qE "formToolMissing agent=codebuddy preset hit .*→ register directly" <<<"$LOG" \
        && ok "无 form 车道命中 preset → 直接注册" \
        || bad "没出现 'formToolMissing ... preset hit ... register directly'"

      if grep -qE "preset-mismatch|preset-partial|no-preset-headers" <<<"$LOG"; then
        bad "身份被判定为不匹配 → 静默 bypass（记忆不会注入）"
        grep -oE "preset team=[^ ]* .*mismatch=[a-z]*" <<<"$LOG" | head -1 | sed 's/^/      /'
      else
        ok "没有 preset 不匹配"
      fi

      grep -qE "→ initialized agent=" <<<"$LOG" \
        && ok "会话已 initialized（$(grep -oE 'agent=[a-z0-9-]+ task=[^ ]* team=[a-z0-9-]+' <<<"$LOG" | head -1)）" \
        || bad "没有 initialized，会话未完成注册"

      grep -qE "\[identity\].*x-agent-id" <<<"$LOG" \
        && ok "x-agent-id 到达 proxy" \
        || bad "x-agent-id 未到达 proxy（header 没发出去）"

      # 兜底：确认注入真的跑了
      grep -qE "\[hook-cache\] prewarm .*(cached=[1-9]|hit blocks=)" <<<"$LOG" \
        && ok "注入 prewarm 有内容" \
        || skip "注入 prewarm 无内容（该 agent 可能没绑定资产）"
    fi
  else
    skip "容器未运行，跳过日志断言"
  fi
  rm -f "$OUT"
fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1m结果:\033[0m %d 通过, %d 失败, %d 跳过\n' "$PASS" "$FAIL" "$SKIP"
(( FAIL == 0 )) || exit 1
