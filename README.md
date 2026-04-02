# im-cc

Control Claude Code on your computer from your phone via Telegram, Feishu/Lark, or WeChat.

As long as your computer is running `imcc` and has internet access, you can reach your local Claude Code from anywhere — no SSH, no open ports, no public IP. The IM platform acts as the relay. This means full tool access: read and write local files, run terminal commands, use MCP servers, switch projects with `/cwd`, run skills — all from your phone.

[中文文档](README_CN.md) | [Changelog](CHANGELOG.md)

## Quick Start

```bash
npm install -g https://github.com/phheng/im-cc
imcc
```

On first run, `imcc` guides you through platform setup, then displays a QR code in the terminal. Scan it from your phone to start chatting with Claude Code.

## Requirements

Claude Code must be installed:

```bash
npm install -g @anthropic-ai/claude-code
```

## Development (from source)

```bash
git clone https://github.com/phheng/im-cc
cd im-cc
npm install
npm run build   # compile TypeScript → dist/
npm test        # run tests
npm run dev     # run without building (uses tsx)
```

## Chat Commands

| Command | Description |
|---------|-------------|
| Any text | Send to Claude Code |
| `/new` | Start a new conversation |
| `/cwd [path]` | Show or change working directory |
| `/model [name]` | Show or set the Claude model for this session |
| `/skills` | List available Claude Code skills |
| `/<skill> [args]` | Run a Claude Code skill |
| `/doctor` | Run Claude Code diagnostics |
| `/info` | Show session info |
| `/help` | Show help |

### Running Skills

Skills are read from `~/.claude/skills/<name>/SKILL.md` and project-local `.claude/skills/`. The skill file is passed as the prompt to Claude Code, which executes it using its full tool suite.

```
/skills              → list available skills
/review              → run the review skill
/ship fix auth bug   → run ship skill with extra context
```

To allow skills to run tool calls without interruption, enable `skipPermissions` in config:

```json
{ "claude": { "skipPermissions": true } }
```

## Platform Setup

**Telegram (user account)** — no registration needed. Run `imcc telegram-login` (or choose Telegram during first-run setup), get API credentials once from [my.telegram.org](https://my.telegram.org), then scan the QR code with the Telegram app. Supports 2FA.

**Telegram (bot mode)** — create a bot via @BotFather, paste the token when prompted. Both modes can run simultaneously.

**Feishu / Lark** — no app registration needed. Run `imcc feishu-login` (or choose Feishu during first-run setup), scan the QR code with Feishu, and credentials are provisioned automatically. Works for both Feishu (China) and Lark (international).

**WeChat** — no registration needed. Run `imcc` (or `imcc login`) and scan the QR code with WeChat.

## Config

Stored at `~/.imcc/config.json`. Key options:

```json
{
  "claude": {
    "command": "claude",
    "skipPermissions": false,
    "model": "claude-opus-4-5"
  },
  "defaultCwd": "/Users/you/Projects",
  "allowedUsers": []
}
```

`allowedUsers` is empty by default (allow all). Add user IDs like `telegram:123456789` to restrict access.

## Architecture

```
Phone (Telegram / Feishu / WeChat)
          ↕ messages
    im-cc gateway (on your machine)
          ↕
  claude -p --output-format stream-json
          ↕
      local files / code
```

## Credits

- [imclaw](https://github.com/smallnest/imclaw)
- [Claude-to-IM](https://github.com/op7418/Claude-to-IM)
- [weclaw](https://github.com/fastclaw-ai/weclaw) — WeChat iLink implementation reference

## License

MIT
