#!/usr/bin/env node
/**
 * im-cc CLI entry point.
 *
 * Usage:
 *   imcc          — start (runs first-time setup if no config found)
 *   imcc start    — start the bridge
 *   imcc login    — add / refresh WeChat login via QR code
 *   imcc config   — print config file path
 */
import { Command } from 'commander'
import chalk from 'chalk'
import { input, confirm, password } from '@inquirer/prompts'
import qrcode from 'qrcode-terminal'
import os from 'os'
import { execSync } from 'child_process'

import {
  loadConfig,
  saveConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  type Config,
} from './config.js'
import { SessionManager } from './session.js'
import { Bridge } from './bridge.js'
import { TelegramAdapter } from './adapters/telegram.js'
import { TelegramUserAdapter } from './adapters/telegram-user.js'
import { FeishuAdapter } from './adapters/feishu.js'
import {
  WechatAdapter,
  fetchWechatQRCode,
  pollWechatLogin,
  type WechatLoginResult,
} from './adapters/wechat.js'
import { feishuQRLogin, type FeishuAuthResult } from './feishu-auth.js'
import { telegramUserQRLogin, type TelegramUserAuthInput } from './telegram-user-auth.js'
import type { TelegramUserConfig } from './config.js'
import type { Adapter } from './adapters/base.js'

const VERSION = '1.1.0'

const program = new Command()
program
  .name('imcc')
  .description('Control Claude Code from your phone via Telegram, Feishu, or WeChat')
  .version(VERSION)

program
  .command('start', { isDefault: true })
  .description('Start the IM bridge')
  .action(runStart)

program
  .command('login')
  .description('Add or refresh a WeChat account via QR code')
  .action(runWechatLogin)

program
  .command('feishu-login')
  .description('Add or refresh Feishu credentials via QR code')
  .action(runFeishuLogin)

program
  .command('telegram-login')
  .description('Add or refresh a Telegram user account via QR code (MTProto — no BotFather needed)')
  .action(runTelegramUserLogin)

program
  .command('config')
  .description('Show config file location')
  .action(() => console.log(CONFIG_FILE))

program.parse()

// ─── start ────────────────────────────────────────────────────────────────────

async function runStart(): Promise<void> {
  printBanner()

  let config = loadConfig()
  if (!config || Object.keys(config.platforms).length === 0) {
    console.log(chalk.yellow('No configuration found. Running first-time setup...\n'))
    config = await runSetup()
  }

  verifyClaudeCLI(config.claude.command)

  const adapters: Adapter[] = []
  if (config.platforms.telegram)     adapters.push(new TelegramAdapter(config.platforms.telegram))
  if (config.platforms.telegramUser) adapters.push(new TelegramUserAdapter(config.platforms.telegramUser))
  if (config.platforms.feishu)       adapters.push(new FeishuAdapter(config.platforms.feishu))
  if (config.platforms.wechat)       adapters.push(new WechatAdapter(config.platforms.wechat))

  if (adapters.length === 0) {
    console.error(chalk.red('No platforms configured. Run `imcc` again.'))
    process.exit(1)
  }

  // Register message handlers BEFORE starting adapters to avoid a startup race:
  // adapters begin receiving events as soon as start() is called, so handlers
  // must be in place first (Feishu in particular would drop all messages otherwise).
  const sessions = new SessionManager(config.defaultCwd)
  const bridge = new Bridge(adapters, sessions, config)
  bridge.start()

  for (const adapter of adapters) await adapter.start()

  console.log('')
  await showConnectInfo(adapters)
  console.log(chalk.green('\n✓ im-cc is running. Press Ctrl+C to stop.\n'))

  const shutdown = async () => {
    console.log('\nShutting down...')
    for (const a of adapters) await a.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// ─── First-run setup ──────────────────────────────────────────────────────────

async function runSetup(): Promise<Config> {
  const config: Config = {
    ...DEFAULT_CONFIG,
    platforms: {},
    claude: { ...DEFAULT_CONFIG.claude },
  }

  // Platform selection
  const useTelegramUser = await confirm({ message: 'Use Telegram (scan QR — no BotFather needed)?', default: true })
  const useTelegram     = await confirm({ message: 'Use Telegram Bot (requires @BotFather token)?', default: false })
  const useFeishu       = await confirm({ message: 'Use Feishu / Lark?', default: false })
  const useWechat       = await confirm({ message: 'Use WeChat (scan QR to login — no app registration needed)?', default: false })

  if (!useTelegramUser && !useTelegram && !useFeishu && !useWechat) {
    console.error(chalk.red('At least one platform required.'))
    process.exit(1)
  }

  if (useTelegramUser) {
    console.log(chalk.cyan('\n📱 Telegram — Scan the QR code below with Telegram\n'))
    config.platforms.telegramUser = await telegramUserLoginFlow()
  }

  if (useTelegram) {
    console.log(chalk.cyan('\n🤖 Telegram Bot Setup'))
    console.log('  1. Open Telegram → message @BotFather')
    console.log('  2. Send /newbot and follow the prompts')
    console.log('  3. Copy the bot token (e.g. 123456:ABC-DEF...)\n')
    const token = await input({ message: 'Bot token:' })
    config.platforms.telegram = { botToken: token.trim() }
  }

  if (useFeishu) {
    console.log(chalk.cyan('\n🪶 Feishu — Scan the QR code below with Feishu\n'))
    config.platforms.feishu = await feishuLoginFlow()
  }

  if (useWechat) {
    console.log(chalk.cyan('\n💬 WeChat — Scan the QR code below with WeChat\n'))
    config.platforms.wechat = await wechatLoginFlow()
  }

  // Claude settings
  console.log(chalk.cyan('\n🤖 Claude Code Settings'))
  const claudeCmd = await input({ message: 'claude binary (path or name):', default: 'claude' })
  config.claude.command = claudeCmd.trim()

  const skipPerms = await confirm({
    message: 'Skip all permission prompts? (--dangerously-skip-permissions)',
    default: false,
  })
  config.claude.skipPermissions = skipPerms

  const defaultCwd = await input({ message: 'Default working directory:', default: os.homedir() })
  config.defaultCwd = defaultCwd.trim()

  saveConfig(config)
  console.log(chalk.green(`\n✓ Config saved to ${CONFIG_FILE}\n`))
  return config
}

// ─── WeChat login ─────────────────────────────────────────────────────────────

async function runWechatLogin(): Promise<void> {
  printBanner()
  console.log(chalk.cyan('WeChat Login — scan the QR code with WeChat\n'))
  const creds = await wechatLoginFlow()
  const config = loadConfig() ?? { ...DEFAULT_CONFIG, platforms: {}, claude: { ...DEFAULT_CONFIG.claude } }
  config.platforms.wechat = creds
  saveConfig(config)
  console.log(chalk.green(`\n✓ WeChat credentials saved. Run \`imcc\` to start.\n`))
}

// ─── Feishu login ─────────────────────────────────────────────────────────────

async function runFeishuLogin(): Promise<void> {
  printBanner()
  console.log(chalk.cyan('Feishu Login — scan the QR code with Feishu\n'))
  const creds = await feishuLoginFlow()
  const config = loadConfig() ?? { ...DEFAULT_CONFIG, platforms: {}, claude: { ...DEFAULT_CONFIG.claude } }
  config.platforms.feishu = creds
  saveConfig(config)
  console.log(chalk.green(`\n✓ Feishu credentials saved. Run \`imcc\` to start.\n`))
}

async function feishuLoginFlow(): Promise<FeishuAuthResult> {
  const ac = new AbortController()
  const creds = await feishuQRLogin(
    async (url) => {
      await renderQRCode(url)
      console.log('')
    },
    (status) => {
      if (status === 'waiting') process.stdout.write(chalk.dim('Waiting for scan...\n'))
      if (status === 'done')    process.stdout.write(chalk.green('\r✓ Feishu login confirmed!             \n'))
      if (status === 'expired') { console.error(chalk.red('\n✗ QR code expired.')); ac.abort() }
    },
    ac.signal,
  )
  return creds
}

async function wechatLoginFlow(): Promise<WechatLoginResult> {
  console.log('Fetching QR code...\n')
  const { qrcode: qrStr } = await fetchWechatQRCode()
  await renderQRCode(qrStr)
  console.log('')

  const ac = new AbortController()
  const creds = await pollWechatLogin(qrStr, (status) => {
    if (status === 'scanned')   process.stdout.write(chalk.yellow('\r✓ Scanned! Waiting for confirmation...'))
    if (status === 'confirmed') process.stdout.write(chalk.green('\r✓ WeChat login confirmed!             \n'))
    if (status === 'expired')   { console.error(chalk.red('\n✗ QR code expired.')); ac.abort() }
  }, ac.signal)

  return creds
}

// ─── Telegram user login ──────────────────────────────────────────────────────

async function runTelegramUserLogin(): Promise<void> {
  printBanner()
  console.log(chalk.cyan('Telegram Login — scan the QR code with Telegram\n'))
  const creds = await telegramUserLoginFlow()
  const config = loadConfig() ?? { ...DEFAULT_CONFIG, platforms: {}, claude: { ...DEFAULT_CONFIG.claude } }
  config.platforms.telegramUser = creds
  saveConfig(config)
  console.log(chalk.green(`\n✓ Telegram credentials saved. Run \`imcc\` to start.\n`))
}

async function telegramUserLoginFlow(): Promise<TelegramUserConfig> {
  console.log(chalk.dim('  Get your API credentials (one-time):'))
  console.log(chalk.dim('  1. Go to https://my.telegram.org'))
  console.log(chalk.dim('  2. Log in → API development tools → Create application'))
  console.log(chalk.dim('  3. Copy the App api_id (integer) and api_hash (string)\n'))

  const apiIdStr = await input({ message: 'API ID (integer):' })
  const apiId = parseInt(apiIdStr.trim(), 10)
  if (isNaN(apiId)) throw new Error('API ID must be an integer.')

  const apiHash = await input({ message: 'API Hash:' })
  if (!apiHash.trim()) throw new Error('API Hash cannot be empty.')

  const has2FA = await confirm({
    message: 'Does your account have Two-Step Verification (2FA) enabled?',
    default: false,
  })

  let twoFAPassword: string | undefined
  if (has2FA) {
    const pwd = await password({ message: '2FA password:' })
    twoFAPassword = pwd || undefined
  }

  const ac = new AbortController()
  const TIMEOUT_MS = 5 * 60 * 1000
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)

  try {
    const input_: TelegramUserAuthInput = { apiId, apiHash: apiHash.trim(), twoFAPassword }
    const creds = await telegramUserQRLogin(
      input_,
      async (url) => {
        await renderQRCode(url)
        console.log(chalk.dim(`\n  Or open in Telegram app: ${url}\n`))
      },
      (status) => {
        if (status === 'waiting') process.stdout.write(chalk.dim('Waiting for scan...\n'))
        if (status === 'done')    process.stdout.write(chalk.green('\r✓ Telegram login confirmed!             \n'))
        if (status === 'expired') { console.error(chalk.red('\n✗ QR code expired.')); ac.abort() }
      },
      ac.signal,
    )
    return creds
  } finally {
    clearTimeout(timer)
  }
}

// ─── Connection info / QR codes ───────────────────────────────────────────────

async function showConnectInfo(adapters: Adapter[]): Promise<void> {
  for (const adapter of adapters) {
    if (adapter instanceof TelegramUserAdapter) {
      console.log(chalk.green('✓ Telegram user account ready.\n'))
    }
    if (adapter instanceof TelegramAdapter) {
      const link = adapter.getBotLink()
      console.log(chalk.bold('🤖 Telegram Bot — scan to open bot:'))
      await renderQRCode(link)
      console.log(chalk.dim(`   ${link}\n`))
    }
    if (adapter instanceof FeishuAdapter) {
      const link = adapter.getBotLink()
      console.log(chalk.bold('🪶 Feishu — scan to open bot:'))
      await renderQRCode(link)
      console.log(chalk.dim(`   ${link}\n`))
    }
    if (adapter instanceof WechatAdapter) {
      console.log(chalk.green('✓ WeChat bot ready.\n'))
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(
    chalk.bold.cyan('\n  im-cc') +
    chalk.dim(` v${VERSION}`) +
    '  ' +
    chalk.dim('Control Claude Code from your phone\n'),
  )
}

function verifyClaudeCLI(command: string): void {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
  } catch {
    console.error(chalk.red(`✗ Cannot find '${command}'. Install Claude Code:`))
    console.error(chalk.dim('  npm install -g @anthropic-ai/claude-code\n'))
    process.exit(1)
  }
}

function renderQRCode(text: string): Promise<void> {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true }, (code: string) => {
      console.log(code)
      resolve()
    })
  })
}
