import { Telegraf, type Context } from 'telegraf'
import type { Adapter, MessageHandler } from './base.js'
import type { TelegramConfig } from '../config.js'
import { splitMessage } from '../utils.js'

export class TelegramAdapter implements Adapter {
  readonly name = 'telegram'

  private bot: Telegraf
  private handler?: MessageHandler
  private botUsername = ''

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken)

    // Handle all text messages
    this.bot.on('text', async (ctx: Context) => {
      if (!this.handler || !ctx.message || !('text' in ctx.message)) return
      const userId = `telegram:${ctx.from?.id}`
      const text = ctx.message.text
      try {
        const reply = await this.handler(userId, text)
        if (reply) {
          // Telegram Markdown v1 is tricky; use plain text for safety
          await ctx.reply(reply)
        }
      } catch (err) {
        await ctx.reply(`⚠️ Error: ${(err as Error).message}`)
      }
    })
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    const chatId = userId.replace('telegram:', '')
    // Split long messages (Telegram limit 4096 chars)
    const chunks = splitMessage(text, 4000)
    for (const chunk of chunks) {
      await this.bot.telegram.sendMessage(chatId, chunk)
    }
  }

  async start(): Promise<void> {
    const me = await this.bot.telegram.getMe()
    this.botUsername = me.username ?? ''
    // launch in background (long-polling)
    this.bot.launch().catch(() => {/* handled by process signals */})
    // Wait for the bot to be ready
    await new Promise<void>((resolve) => setTimeout(resolve, 500))
  }

  async stop(): Promise<void> {
    this.bot.stop('SIGTERM')
  }

  /** Returns the t.me deep-link for QR code display. */
  getBotLink(): string {
    return `https://t.me/${this.botUsername}`
  }

  getBotUsername(): string {
    return this.botUsername
  }
}

