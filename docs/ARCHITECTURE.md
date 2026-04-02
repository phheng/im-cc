# Architecture Overview

> This file is written for LLM context. It explains *why* the code is shaped the way it is.
> Read this before diving into source files.

## What this project is

im-cc is a gateway that lets you control your local **Claude Code CLI** (`claude -p`) from a phone via IM apps (Telegram, Feishu/Lark, WeChat). The key distinction from similar projects:

- **Other projects** (imclaw, Claude-to-IM): connect IM to the Claude *API* (HTTP, text-only)
- **im-cc**: connects IM to the Claude Code *CLI* — full tool access (file read/write, terminal, MCP servers)

The IM platform's servers act as the relay. Your phone and computer never connect directly. No SSH, no open ports, no public IP required.

## Core data flow

```
Phone (IM app)
    ↕  internet
IM platform servers
    ↕  internet (polling / WebSocket)
imcc process (on your machine)
    ↕  local
claude -p --output-format stream-json --resume <session_id>
    ↕  local
Files / terminal / MCP
```

## Key design decisions

### 1. `claude -p` instead of PTY or API

Claude Code is a CLI tool, not just an API wrapper. To get multi-turn conversation and the full tool suite, we spawn:

```
claude -p <message> --output-format stream-json --verbose --resume <session_id>
```

`stream-json` gives structured JSON events. `--resume` maintains conversation context across invocations.
We considered PTY but rejected it: PTY is fragile, platform-specific, and hard to parse reliably.

### 2. Adapter pattern (`src/adapters/base.ts`)

All three IM platforms implement the same four-method interface:
```typescript
interface Adapter {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: MessageHandler): void
  sendMessage(userId: string, text: string): Promise<void>
}
```

`Bridge` (`src/bridge.ts`) speaks only to this interface. Adding a new platform requires no changes to bridge or session logic.

### 3. Per-user message queue (`src/bridge.ts` — `enqueueForUser`)

If a user sends two messages before the first Claude response arrives, two concurrent `claude -p` processes would clobber each other's `--resume` session ID. We serialize per-user via promise chaining:

```typescript
const prev = this.queues.get(userId) ?? Promise.resolve()
const resultP = prev.then(() => task(), () => task())
```

Other users are unaffected — only the same userId is serialized.

### 4. Startup order matters (startup race bug, fixed in v1.1)

`bridge.start()` must be called **before** `adapter.start()`. The Feishu WebSocket can fire `im.message.receive_v1` during the connect handshake. If `bridge.start()` (which registers `onMessage` handlers) runs after, the first message is silently dropped.

### 5. Skill passthrough via prompt injection

Claude Code skills (`SKILL.md` files) are passed directly as the `-p` prompt to `claude`. No PTY needed. Limitation: if a skill uses `AskUserQuestion`, Claude self-decides rather than prompting the IM user. Acceptable trade-off for now.

### 6. Session state

`src/session.ts` tracks per-user state: `cwd`, `claudeSessionId` (for `--resume`), `modelOverride`. The `claudeSessionId` is extracted from the `session_id` field in the `stream-json` output and stored for the next turn.

## File map

```
src/
  cli.ts              Entry point, CLI commands, first-run wizard
  bridge.ts           Routes IM messages → commands or Claude; per-user queue
  claude.ts           Spawns claude -p, parses stream-json output
  session.ts          Per-user session state (cwd, claudeSessionId, modelOverride)
  config.ts           Config types + read/write ~/.imcc/config.json
  utils.ts            splitMessage() shared by all adapters
  skill-loader.ts     Finds and reads SKILL.md files
  feishu-auth.ts      Feishu device registration QR login flow
  telegram-user-auth.ts  Telegram MTProto QR login (gramjs)
  adapters/
    base.ts           Adapter interface
    telegram.ts       Telegraf (Bot API)
    telegram-user.ts  gramjs (MTProto user account)
    feishu.ts         @larksuiteoapi/node-sdk WebSocket long-connection
    wechat.ts         WeChat iLink HTTP long-polling
```

## License obligations

- `src/adapters/wechat.ts`: ported from [weclaw](https://github.com/fastclaw-ai/weclaw) (MIT). Copyright notice must be preserved.
- `src/feishu-auth.ts`: reverse-engineered from `@larksuite/openclaw-lark-tools` (ISC). Copyright notice must be preserved.
- All npm dependencies: see `node_modules/*/LICENSE`.
