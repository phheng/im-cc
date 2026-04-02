# im-cc

用手机聊天软件控制电脑上的 Claude Code。

支持 **Telegram**、**飞书 / Lark**、**微信**（iLink，扫码即登录）。

只要你的电脑开着 `imcc` 并能访问互联网，你就能在任何地方通过手机使用本地的 Claude Code，无需 SSH、无需开放端口、无需公网 IP。IM 平台的服务器充当中转，你的手机和电脑不需要直接连通。这意味着完整的工具能力随手可用：读写本地文件、执行终端命令、调用 MCP、用 `/cwd` 切换项目、运行 skill，全部通过手机完成。

[English](README.md) | [更新日志](CHANGELOG_CN.md)

## 快速开始

```bash
# 全局安装
npm install -g https://github.com/phheng/im-cc

# 启动（首次运行会引导配置）
imcc
```

首次启动时，im-cc 会引导你：

1. 选择聊天平台（Telegram / 飞书 / 微信）
2. 输入对应凭据（微信和飞书只需扫码，无需注册）
3. 保存配置到 `~/.imcc/config.json`
4. 在终端显示二维码，用手机扫码绑定

## 前提条件

已通过 CLI 安装 Claude Code：

```bash
npm install -g @anthropic-ai/claude-code
```

## 聊天命令

在 IM 中发送以下命令：

| 命令 | 说明 |
|------|------|
| 任意文字 | 发送给 Claude Code |
| `/new` | 开始新对话（清除会话） |
| `/cwd [路径]` | 查看或切换工作目录 |
| `/model [名称]` | 查看或设置当前会话的 Claude 模型 |
| `/skills` | 列出可用 skill |
| `/<skill> [参数]` | 运行 Claude Code skill |
| `/allow` | 批准待确认的工具权限并重试 |
| `/deny` | 取消待确认的工具权限 |
| `/doctor` | 执行 Claude Code 诊断 |
| `/info` | 查看当前会话信息 |
| `/help` | 显示帮助 |

切换工作目录会自动重置当前对话：

```
/cwd ~/Projects/my-app
✓ Working directory changed to: /Users/you/Projects/my-app
  Conversation reset.
```

### 运行 Skill

Skill 从 `~/.claude/skills/<名称>/SKILL.md` 和项目本地 `.claude/skills/` 读取。Skill 文件作为 prompt 传给 Claude Code，由 Claude 使用完整工具能力执行。

```
/skills              → 列出所有可用 skill
/review              → 运行 review skill
/ship fix auth bug   → 运行 ship skill，附带额外上下文
```

### 权限确认

当 `skipPermissions` 为 `false`（默认值）时，Claude 在调用 `Write`、`Bash` 等工具前可能会触发权限确认。im-cc 会将被拦截的工具列表推送到你的手机并等待：

```
🔐 Permission required

Claude wants to use:
• Write: /src/main.ts
• Bash: npm install express

Reply /allow to proceed, or /deny to cancel.
```

发送 `/allow` 以授权并重新执行，或发送 `/deny` 取消。

如需让 skill 的工具调用无需逐步确认，在配置中开启 `skipPermissions`：

```json
{ "claude": { "skipPermissions": true } }
```

## 平台配置

### Telegram（用户账号，推荐）

**无需创建 Bot**，和微信、飞书一样扫码激活：

```bash
imcc telegram-login
```

1. 前往 [my.telegram.org](https://my.telegram.org) → API development tools → 创建应用，获取 `api_id` 和 `api_hash`（一次性操作）
2. 运行 `imcc telegram-login`，输入凭据
3. 终端显示二维码，用 Telegram 手机 App 扫码
4. 支持两步验证（2FA）

也可以在首次运行 `imcc` 时选择，同样引导扫码。

### Telegram Bot（可选）

如需 Bot 模式，仍可通过 @BotFather 创建：

1. 打开 Telegram，向 @BotFather 发送 `/newbot`
2. 按提示创建 bot，复制 token
3. 运行 `imcc`，选择「Telegram Bot」并输入 token

用户账号模式与 Bot 模式可同时运行、互不影响。

### 飞书 / Lark

**无需手动创建应用**，和微信一样扫码激活：

```bash
imcc feishu-login
```

终端显示二维码后，用飞书扫码，自动创建 Bot 应用并获取凭据。支持飞书（国内）和 Lark（国际）。

也可以在首次运行 `imcc` 时选择飞书平台，同样引导扫码。

### 微信（iLink）

无需提前注册，直接运行：

```bash
imcc
```

或刷新登录：

```bash
imcc login
```

终端显示二维码后，用微信扫码即完成登录。凭据保存在 `~/.imcc/config.json`。

## 配置文件

配置保存在 `~/.imcc/config.json`：

```json
{
  "platforms": {
    "telegram": { "botToken": "123456:ABC..." },
    "feishu":   { "appId": "cli_xxx", "appSecret": "xxx" },
    "wechat":   { "botToken": "...", "ilinkBotId": "...", "baseUrl": "...", "ilinkUserId": "..." }
  },
  "claude": {
    "command": "claude",
    "skipPermissions": false,
    "model": "claude-opus-4-5",
    "extraArgs": []
  },
  "defaultCwd": "/Users/you/Projects",
  "allowedUsers": []
}
```

`allowedUsers` 留空表示允许所有用户，填入用户 ID（如 `telegram:123456789`）则只允许指定用户。

## 多用户

每个用户拥有独立的 Claude Code 会话和工作目录。会话通过 `--resume` 保持多轮对话上下文。同一用户的并发消息会自动排队，不会产生重复的 Claude 进程。

## 架构

```
手机 (Telegram / 飞书 / 微信)
         ↕ 消息
    im-cc 网关（运行在你的电脑上）
         ↕
  claude -p --output-format stream-json
         ↕
      本地文件 / 代码
```

Claude 集成使用 `claude -p`（print 模式）配合 `--output-format stream-json` 和 `--resume <session_id>`，复用已安装的 claude CLI，无需额外配置。

## 参考项目

- [imclaw](https://github.com/smallnest/imclaw) — ACP 协议网关
- [Claude-to-IM](https://github.com/op7418/Claude-to-IM) — IM 桥接库
- [weclaw](https://github.com/fastclaw-ai/weclaw) — 微信 iLink 集成（感谢提供 iLink API 的实现参考）

## 开源协议

MIT
