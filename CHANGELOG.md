# Changelog

[中文](CHANGELOG_CN.md)

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-04-02

### Added

- **Telegram QR login** — new `imcc telegram-login` command; log in as a Telegram user account (MTProto) by scanning a QR code with the Telegram mobile app. No @BotFather, no manual token entry. Credentials from [my.telegram.org](https://my.telegram.org) required once.
- **Two-Factor Authentication (2FA) support** — prompted during `telegram-login` if the account has Two-Step Verification enabled.
- **Telegram Bot and User modes coexist** — configure both `telegram` (bot) and `telegramUser` (user account) in the same config; both start independently.
- First-run wizard now offers Telegram QR login as the default option.
- **`/model [name]`** — show or set the Claude model for the current session; resets conversation so the new model takes effect immediately. Example: `/model claude-sonnet-4-5`.
- **`/doctor`** — runs `claude doctor` diagnostics and returns the output inline.
- **`/skills`** — lists all available Claude Code skills found in `~/.claude/skills/` and `.claude/skills/`.
- **`/<skill> [args]`** — run a Claude Code skill by name. The skill's `SKILL.md` is passed as the prompt to Claude Code, which executes it with full tool access. Optional arguments are appended. Example: `/review`, `/ship fix auth bug`.
- **Skill passthrough** — skills are executed via `claude -p` prompt injection (no PTY required); compatible with all platforms. Set `skipPermissions: true` in config to allow tool calls without interruption.

---

## [1.0.0] - 2025-04-02

Initial release.

### Platforms

- **Telegram** — connect via @BotFather token; QR code shown in terminal on startup
- **Feishu / Lark** — QR code activation via device registration flow (`imcc feishu-login`); no manual app creation required; auto-detects Feishu (China) vs Lark (international)
- **WeChat** — QR code login via iLink bot API (`imcc login`); no app registration required

### Features

- **Multi-user** — each user gets an isolated Claude Code session and working directory
- **Multi-turn conversations** — sessions resume automatically via `--resume <session_id>`
- **Per-user message queue** — concurrent messages from the same user are serialized; no duplicate Claude processes
- **Chat commands** — `/new`, `/cwd [path]`, `/info`, `/help`
- **Allowed users** — optional whitelist via `allowedUsers` in config (`telegram:123`, `feishu:abc`, ...)
- **Configurable Claude** — custom binary path, model, system prompt, extra args, skip-permissions flag
- **WeChat message dedup** — in-memory dedup prevents message replay on restart
- **Long message splitting** — messages exceeding platform limits are chunked automatically

### Technical

- TypeScript + ESM (`type: "module"`)
- Claude Code integration via `claude -p --output-format stream-json --verbose`
- Node.js ≥ 20 required
