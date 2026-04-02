/**
 * WeChat adapter via the iLink Bot API (ilinkai.weixin.qq.com).
 *
 * Architecture ported from weclaw (https://github.com/fastclaw-ai/weclaw, MIT).
 * QR code login: no pre-registration needed — just run `imcc` and scan with WeChat.
 */
import type { Adapter, MessageHandler } from './base.js'
import type { WechatConfig } from '../config.js'
import { splitMessage } from '../utils.js'

const ILINK_BASE = 'https://ilinkai.weixin.qq.com'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ILinkMessage {
  seq?: number
  message_id?: number
  from_user_id: string
  to_user_id: string
  message_type: number   // 1 = user, 2 = bot
  message_state: number  // 0 = new, 1 = generating, 2 = finish
  item_list: ILinkItem[]
  context_token?: string
}

interface ILinkItem {
  type: number           // 1 = text, 2 = image, 3 = voice, 4 = file, 5 = video
  text_item?: { text: string }
  voice_item?: { text?: string } // voice-to-text transcription from WeChat
}

interface GetUpdatesResponse {
  ret: number
  errcode?: number
  errmsg?: string
  msgs?: ILinkMessage[]
  get_updates_buf?: string
}

export interface QRCodeData {
  /** The raw QR code string — pass to qrcode-terminal to render */
  qrcode: string
}

export interface WechatLoginResult extends WechatConfig {}

// ─── Helper ───────────────────────────────────────────────────────────────────

function generateWechatUIN(): string {
  // Mirrors weclaw: random uint32 as decimal string, base64-encoded
  const n = Math.floor(Math.random() * 0xffffffff)
  return Buffer.from(String(n)).toString('base64')
}

// ─── Login flow ───────────────────────────────────────────────────────────────

/**
 * Fetch a WeChat iLink login QR code.
 * The returned `qrcode` string should be rendered in the terminal.
 */
export async function fetchWechatQRCode(): Promise<QRCodeData> {
  const res = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`)
  if (!res.ok) throw new Error(`iLink QR code fetch failed: ${res.status}`)
  const data = await res.json() as { qrcode: string }
  return { qrcode: data.qrcode }
}

/**
 * Poll iLink until the QR code is scanned and confirmed.
 * Calls `onStatus` with "scanned" or "confirmed" as status changes.
 * Resolves with credentials once confirmed.
 */
export async function pollWechatLogin(
  qrcode: string,
  onStatus: (status: 'waiting' | 'scanned' | 'confirmed' | 'expired') => void,
  signal?: AbortSignal,
): Promise<WechatLoginResult> {
  onStatus('waiting')

  while (true) {
    if (signal?.aborted) throw new Error('Login cancelled')
    await sleep(2000)

    const res = await fetch(
      `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${qrcode}`,
      { signal },
    )
    if (!res.ok) continue
    const data = await res.json() as {
      status: string
      bot_token: string
      ilink_bot_id: string
      baseurl: string
      ilink_user_id: string
    }

    switch (data.status) {
      case 'scaned':
        onStatus('scanned')
        break
      case 'confirmed':
        onStatus('confirmed')
        return {
          botToken: data.bot_token,
          ilinkBotId: data.ilink_bot_id,
          baseUrl: data.baseurl || ILINK_BASE,
          ilinkUserId: data.ilink_user_id,
        }
      case 'expired':
        onStatus('expired')
        throw new Error('QR code expired. Please run imcc again.')
    }
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WechatAdapter implements Adapter {
  readonly name = 'wechat'

  private wechatUIN = generateWechatUIN()
  private handler?: MessageHandler
  private running = false
  private updateBuf = ''
  private seenMessageIds = new Set<number>()
  private readonly SEEN_LIMIT = 200

  constructor(private config: WechatConfig) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${this.config.botToken}`,
      'X-WECHAT-UIN': this.wechatUIN,
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const base = this.config.baseUrl || ILINK_BASE
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    })
    return res.json() as Promise<T>
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    const toUserId = userId.replace('wechat:', '')
    // Split long messages
    const chunks = splitMessage(text, 2000)
    for (const chunk of chunks) {
      await this.post('/ilink/bot/sendmessage', {
        msg: {
          from_user_id: this.config.ilinkBotId,
          to_user_id: toUserId,
          client_id: randomId(),
          message_type: 2,  // bot
          message_state: 2, // finish
          item_list: [{ type: 1, text_item: { text: chunk } }],
        },
        base_info: { channel_version: '1.0.0' },
      })
    }
  }

  async start(): Promise<void> {
    this.running = true
    // Start long-poll loop in background
    void this.pollLoop()
  }

  async stop(): Promise<void> {
    this.running = false
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const res = await this.post<GetUpdatesResponse>('/ilink/bot/getupdates', {
          get_updates_buf: this.updateBuf,
          base_info: { channel_version: '1.0.0' },
        })

        if (res.get_updates_buf) this.updateBuf = res.get_updates_buf

        for (const msg of res.msgs ?? []) {
          if (msg.message_type !== 1) continue // only incoming user messages
          void this.handleMessage(msg)
        }
      } catch {
        // Timeout is normal for long-polling; network errors: back-off briefly
        if (!this.running) break
        await sleep(1000)
      }
    }
  }

  private async handleMessage(msg: ILinkMessage): Promise<void> {
    if (!this.handler) return

    // Deduplicate: skip messages we've already processed this session
    if (msg.message_id != null) {
      if (this.seenMessageIds.has(msg.message_id)) return
      this.seenMessageIds.add(msg.message_id)
      if (this.seenMessageIds.size > this.SEEN_LIMIT) {
        this.seenMessageIds.delete(this.seenMessageIds.values().next().value!)
      }
    }

    let text = ''
    for (const item of msg.item_list) {
      if (item.type === 1 && item.text_item) {
        text = item.text_item.text
        break
      }
      // Voice message: use WeChat's built-in speech-to-text
      if (item.type === 3 && item.voice_item?.text) {
        text = item.voice_item.text
        break
      }
    }
    if (!text.trim()) return

    const userId = `wechat:${msg.from_user_id}`
    try {
      const reply = await this.handler(userId, text)
      if (reply) await this.sendMessage(userId, reply)
    } catch (err) {
      await this.sendMessage(userId, `⚠️ Error: ${(err as Error).message}`)
    }
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function randomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

