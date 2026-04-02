# 更新日志

[English](CHANGELOG.md)

本文件记录项目的所有重要变更。

## [1.1.0] - 2026-04-02

### 新增

- **Telegram 扫码登录** — 新增 `imcc telegram-login` 命令；以 Telegram 用户账号（MTProto 协议）登录，用 Telegram 手机 App 扫码即完成认证，无需 @BotFather，无需手动复制 token。仅需在 [my.telegram.org](https://my.telegram.org) 一次性获取 API 凭据。
- **两步验证（2FA）支持** — 登录时若账号开启了两步验证，会引导输入密码。
- **Bot 模式与用户账号模式共存** — 同一配置文件中可同时配置 `telegram`（Bot）和 `telegramUser`（用户账号），两者独立运行互不影响。
- 首次运行向导将 Telegram 扫码登录作为默认选项。
- **`/model [名称]`** — 查看或设置当前会话使用的 Claude 模型；切换后自动重置对话使新模型立即生效。示例：`/model claude-sonnet-4-5`。
- **`/doctor`** — 执行 `claude doctor` 诊断并将结果直接返回。
- **`/skills`** — 列出 `~/.claude/skills/` 和 `.claude/skills/` 下所有可用的 Claude Code skill。
- **`/<skill> [参数]`** — 按名称运行 Claude Code skill。skill 的 `SKILL.md` 作为 prompt 传给 Claude Code，Claude 使用完整工具能力执行。可附带额外参数。示例：`/review`、`/ship fix auth bug`。
- **Skill 透传** — skill 通过 `claude -p` prompt 注入方式执行（无需 PTY），所有平台均支持。在配置中设置 `skipPermissions: true` 可让工具调用无需逐步确认。
- **权限确认流程** — 当 Claude 触发权限拦截（如需要写文件或执行 shell 命令）时，im-cc 会将被拦截的工具列表推送到用户 IM 端，等待用户决策。用户发送 `/allow` 即授权并重新执行原始请求，发送 `/deny` 则取消操作，不产生任何副作用。支持随时随地通过手机操作。
- **`/allow`** — 批准待确认的权限请求，以 `--dangerously-skip-permissions` 重新运行原始消息。
- **`/deny`** — 取消待确认的权限请求，不执行任何操作。

---

## [1.0.0] - 2025-04-02

首次正式发布。

### 平台支持

- **Telegram** — 通过 @BotFather token 接入；启动时终端显示二维码
- **飞书 / Lark** — 扫码激活，无需手动创建应用（`imcc feishu-login`）；自动识别飞书（国内）和 Lark（国际）
- **微信** — 通过 iLink Bot API 扫码登录（`imcc login`）；无需注册任何应用

### 功能

- **多用户** — 每个用户拥有独立的 Claude Code 会话和工作目录
- **多轮对话** — 通过 `--resume <session_id>` 自动保持上下文
- **消息队列** — 同一用户的并发消息自动排队，不会产生重复的 Claude 进程
- **聊天命令** — `/new`、`/cwd [路径]`、`/info`、`/help`
- **用户白名单** — 通过配置 `allowedUsers` 限制访问（支持 `telegram:123`、`feishu:abc` 等格式）
- **Claude 自定义** — 支持自定义二进制路径、模型、系统提示词、额外参数、跳过权限确认
- **微信消息去重** — 内存去重，避免重启后消息重放
- **长消息分片** — 超出平台字数限制的消息自动拆分发送

### 技术实现

- TypeScript + ESM（`type: "module"`）
- Claude Code 集成：`claude -p --output-format stream-json --verbose`
- 需要 Node.js ≥ 20
