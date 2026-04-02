/**
 * Telegram user-account adapter (MTProto via gramjs).
 *
 * Authenticates as a Telegram user account (not a bot) using a saved session
 * string from `telegramUserQRLogin`. Receives incoming private messages and
 * replies using the same account.
 *
 * userId format: `telegramUser:<numeric_id>`
 */
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js'
import type { Adapter, MessageHandler } from './base.js'
import type { TelegramUserConfig } from '../config.js'
import { splitMessage } from '../utils.js'

export class TelegramUserAdapter implements Adapter {
  readonly name = 'telegramUser'

  private client: TelegramClient
  private handler?: MessageHandler

  constructor(private config: TelegramUserConfig) {
    this.client = new TelegramClient(
      new StringSession(config.session),
      config.apiId,
      config.apiHash,
      { connectionRetries: 5 },
    )
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    // Keep peer ID as string to avoid bigint → number precision loss for large IDs
    const peerId = userId.replace('telegramUser:', '')
    const chunks = splitMessage(text, 4000)
    for (const chunk of chunks) {
      await this.client.sendMessage(peerId, { message: chunk })
    }
  }

  async start(): Promise<void> {
    try {
      await this.client.connect()
    } catch (err: unknown) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('AUTH_KEY_UNREGISTERED') || msg.includes('SESSION_REVOKED')) {
        throw new Error(
          'Telegram session expired or revoked. Run `imcc telegram-login` to re-authenticate.',
        )
      }
      throw err
    }

    this.client.addEventHandler(
      (event: NewMessageEvent) => { void this.handleEvent(event) },
      new NewMessage({ incoming: true, func: (e) => e.isPrivate === true }),
    )

    console.log('✓ Telegram user account connected')
  }

  async stop(): Promise<void> {
    await this.client.disconnect()
  }

  private async handleEvent(event: NewMessageEvent): Promise<void> {
    if (!this.handler) return

    const msg = event.message
    const text = msg.text
    if (!text?.trim()) return

    // senderId is BigInt on incoming private messages — use toString() to keep precision
    const senderId = msg.senderId
    if (senderId == null) return
    const userId = `telegramUser:${senderId.toString()}`

    try {
      const reply = await this.handler(userId, text)
      if (reply) await this.sendMessage(userId, reply)
    } catch (err) {
      await this.sendMessage(userId, `⚠️ Error: ${(err as Error).message}`)
    }
  }
}
