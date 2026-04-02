/**
 * Feishu / Lark adapter.
 *
 * Uses the @larksuiteoapi/node-sdk long-connection (WebSocket) mode to receive
 * messages without requiring a public HTTPS endpoint.
 */
import * as lark from '@larksuiteoapi/node-sdk'
import type { Adapter, MessageHandler } from './base.js'
import type { FeishuConfig } from '../config.js'
import { splitMessage } from '../utils.js'

// The SDK's Client type doesn't expose `im` in its public types in v1.x,
// so we access it via `any` where needed and document the actual API shape.
type LarkClient = InstanceType<typeof lark.Client> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  im: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  application: any
}

export class FeishuAdapter implements Adapter {
  readonly name = 'feishu'

  private client: LarkClient
  private handler?: MessageHandler
  private botOpenId = ''

  constructor(private config: FeishuConfig) {
    const isLark = config.domain === 'lark'
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: isLark ? lark.Domain.Lark : lark.Domain.Feishu,
    }) as LarkClient
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    const openId = userId.replace('feishu:', '')
    const chunks = splitMessage(text, 4000)
    for (const chunk of chunks) {
      await this.client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'text',
          content: JSON.stringify({ text: chunk }),
        },
      })
    }
  }

  async start(): Promise<void> {
    // Try to get bot's open_id (for QR code link — non-fatal if it fails)
    try {
      const res = await this.client.application.application.get({
        params: { app_id: this.config.appId },
      }) as { app?: { app_id?: string } }
      // Bot open_id is not directly available via this API; use app_id as fallback
      this.botOpenId = res.app?.app_id ?? ''
    } catch {
      // non-fatal
    }

    // Set up event handler — use this.handler at call time (not captured at start time)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = new lark.EventDispatcher({}).register({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'im.message.receive_v1': async (data: any) => {
        if (!this.handler) return
        const msg = data?.message
        if (!msg || msg.message_type !== 'text') return

        const senderId = data?.sender?.sender_id?.open_id as string | undefined
        if (!senderId) return
        const userId = `feishu:${senderId}`

        let text = ''
        try {
          text = (JSON.parse(msg.content ?? '{}') as { text?: string }).text ?? ''
        } catch {
          return
        }
        if (!text.trim()) return

        try {
          const reply = await this.handler(userId, text)
          if (reply) await this.sendMessage(userId, reply)
        } catch (err) {
          await this.sendMessage(userId, `⚠️ Error: ${(err as Error).message}`)
        }
      },
    })

    const wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    // start() is sync in v1.x; dispatches events asynchronously
    wsClient.start({ eventDispatcher: dispatcher })
    // Brief delay to allow WebSocket handshake
    await new Promise<void>((resolve) => setTimeout(resolve, 600))
    console.log('✓ Feishu bot started')
  }

  async stop(): Promise<void> {
    // WSClient has no stop method in v1.x — process exit handles cleanup
  }

  /** Returns a Feishu deeplink to open a chat with the bot. */
  getBotLink(): string {
    if (this.botOpenId) {
      return `https://applink.feishu.cn/client/chat/open?openId=${this.botOpenId}`
    }
    return 'https://open.feishu.cn'
  }
}

