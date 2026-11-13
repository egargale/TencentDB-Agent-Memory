/** English `mem:help` output (fork). Structure mirrors `../help.ts`. */

export const HELP_TEXT_EN = `## Supported mem: commands

| Command | What it does |
|------|------|
| \`mem:session-reset\` | Reset this session's Team/Agent/Task binding and show the picker again |
| \`mem:sync\` | Refresh every injected asset for this session (Skill / memory / Knowledge / Task & Agent descriptions) |
| \`mem:create-skill [prompt]\` | Archive this conversation as a Skill; extraction runs in the background |
| \`mem:create-task [title]\` | Create a Task from the current conversation and bind it to this session |
| \`mem:update-task [new description]\` | Update the description of the bound Task |
| \`mem:config-lock\` | Save this session's Team/Agent/Task as your **account-level default**; new sessions then skip the picker (an existing default is shown for \`confirm\` before it is overwritten) |
| \`mem:config-unlock\` | Clear the account-level default; new sessions go back to manual selection (**this conversation is unaffected**) |
| \`mem:help\` | Show this help |

---

### 🆕 \`mem:create-task\` — create and bind a Task

**Usage**
- **No argument**: the LLM infers title + description from the recent conversation
- **With an argument**: the argument becomes the title (truncated to 40 chars); the LLM only writes the description

**If this session is already bound to a real Task**, you get a preview of the new Task and reply with one of:

| Reply | Effect |
|------|------|
| \`mem:create-task confirm\` | ✅ Overwrite the binding and create the new Task |
| \`mem:update-task\` or \`mem:update-task <new description>\` | ⭐ **Recommended** — keep the current Task and only update its description |
| \`mem:create-task cancel\` | 🚫 Cancel, change nothing |

---

### ✏️ \`mem:update-task\` — update the current Task description

**Usage**
- **No argument**: the LLM compares "current description + recent conversation" and writes a new description
  - No substantive change → returns ℹ️ nothing to update (idempotent, safe to retry)
  - Change detected → returns a preview
- **With an argument**: the argument is used as the new description (no LLM call) and returned as a preview

**Confirming a preview**:
- ✅ \`mem:update-task confirm\` — confirm
- 🚫 \`mem:update-task cancel\` — cancel

**Guard rails**:
- If this session has no Task bound → blocked, with a hint to run \`mem:create-task\` first
- If the bound Task was not created by you → refused (cross-user edits unsupported); create your own with \`mem:create-task\`

---

### 🔒 \`mem:config-lock\` — save an account-level default (Team/Agent/Task)

**Usage**
- \`mem:config-lock\` — save this session's Team/Agent/Task as your account default.
- **When it would overwrite a different existing default, the pending configuration is shown first for confirmation** (to avoid accidental overwrites):
  1. \`mem:config-lock\` → shows "configuration to save + the old one it will replace"
  2. \`mem:config-lock confirm\` → confirm and save
  3. \`mem:config-lock cancel\` → cancel, change nothing
- With **no** existing default, or an identical one, it saves in one step without asking.
- A confirmation is valid for 5 minutes; after that just run \`mem:config-lock\` again.

**Scope**
- Once saved, **every new session** skips the "attach team assets / Team / Agent / Task" selection.
- Sessions already in progress are unaffected.
- You only ever save your own default; even an admin cannot set a member's default.
- An existing default is **overwritten** directly (that is the intended semantics of the command).
- Saved the wrong one? Run \`mem:config-unlock\`, or run this command again to overwrite.

**Preconditions**
- The session must have finished Team/Agent selection (initialized), otherwise the command asks you to pick one first.
- A Task of "skip for now" can also be saved (stored as the virtual \`default\`, meaning no Task bound).

---

### 🔓 \`mem:config-unlock\` — clear the account-level default

**Usage**
- \`mem:config-unlock\` → clears it directly (idempotent; fine when there is no default).
- **This conversation is unaffected** — the current Agent identity stays the same.

**Scope**
- New sessions fall back from the header preset to manual selection again.
- To switch to a different default: \`mem:config-unlock\` → open a new session and pick Team/Agent/Task → \`mem:config-lock\`.
- You can also edit it in the panel under Agents · Session defaults.

---

### Examples

\`\`\`
mem:sync
mem:create-skill summarise the database migration steps and pitfalls
mem:create-task Refactor SessionRegistrar
mem:create-task confirm
mem:create-task cancel
mem:update-task add today's progress and remaining risks
mem:update-task confirm
mem:update-task cancel
mem:session-reset
mem:config-lock
mem:config-lock confirm
mem:config-lock cancel
mem:config-unlock
mem:help
\`\`\`

> The canonical form is \`mem:<command>\`, with no space after the colon. Command names are case-insensitive.`;
