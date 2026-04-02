import os from 'os'
import fs from 'fs'
import path from 'path'

export const CONFIG_DIR = path.join(os.homedir(), '.imcc')
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export interface TelegramConfig {
  botToken: string
}

export interface TelegramUserConfig {
  apiId: number
  apiHash: string
  /** Serialized gramjs StringSession — saved after first QR login */
  session: string
  /** Optional 2FA password, stored only if user opts in */
  twoFAPassword?: string
}

export interface FeishuConfig {
  appId: string
  appSecret: string
  /** 'feishu' (China) or 'lark' (international). Determined at login. */
  domain?: 'feishu' | 'lark'
}

export interface WechatConfig {
  botToken: string
  ilinkBotId: string
  baseUrl: string
  ilinkUserId: string
}

export interface ClaudeConfig {
  /** Path or name of the claude binary, default 'claude' */
  command: string
  /** Skip all permission prompts (--dangerously-skip-permissions) */
  skipPermissions: boolean
  model?: string
  systemPrompt?: string
  /** Additional raw args passed to claude -p */
  extraArgs?: string[]
}

export interface Config {
  platforms: {
    telegram?: TelegramConfig
    telegramUser?: TelegramUserConfig
    feishu?: FeishuConfig
    wechat?: WechatConfig
  }
  claude: ClaudeConfig
  /** Default working directory for Claude Code sessions */
  defaultCwd: string
  /** Authorized user IDs (platform:id). Empty = allow all */
  allowedUsers?: string[]
}

export const DEFAULT_CONFIG: Config = {
  platforms: {},
  claude: {
    command: 'claude',
    skipPermissions: false,
  },
  defaultCwd: process.env.HOME ?? process.cwd(),
}

export function loadConfig(): Config | null {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Config>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      claude: { ...DEFAULT_CONFIG.claude, ...parsed.claude },
      platforms: { ...DEFAULT_CONFIG.platforms, ...parsed.platforms },
    }
  } catch {
    return null
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}
