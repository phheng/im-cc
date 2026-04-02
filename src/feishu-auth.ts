/**
 * Feishu device registration flow.
 *
 * Reverse-engineered from @larksuite/openclaw-lark-tools (ISC license).
 * Implements the /oauth/v1/app/registration endpoint to create a bot app
 * by scanning a QR code — no manual app registration required.
 *
 * Flow:
 *   1. init  → confirm client_secret auth is supported
 *   2. begin → get device_code + QR code URL (verification_uri_complete)
 *   3. Caller renders QR code; user scans with Feishu app
 *   4. poll  → returns appId (client_id) + appSecret (client_secret)
 */

export type FeishuDomain = 'feishu' | 'lark'

export interface FeishuAuthResult {
  appId: string
  appSecret: string
  domain: FeishuDomain
  userOpenId?: string
}

interface InitResponse {
  supported_auth_methods: string[]
}

interface BeginResponse {
  device_code: string
  verification_uri_complete: string
  interval: number   // seconds between polls
  expire_in: number  // total seconds until expiry
}

interface PollResponse {
  client_id?: string
  client_secret?: string
  error?: string
  user_info?: {
    open_id?: string
    tenant_brand?: string
  }
}

const FEISHU_BASE = 'https://open.feishu.cn'
const LARK_BASE   = 'https://open.larksuite.com'
const REG_PATH    = '/oauth/v1/app/registration'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function registrationPost(
  base: string,
  params: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(`${base}${REG_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  })
  // API returns 4xx for some poll states — still parse body
  const text = await res.text()
  try { return JSON.parse(text) } catch { return {} }
}

/**
 * Run the full Feishu device registration flow.
 *
 * @param onQRCode  Called with the URL to render as a QR code
 * @param onStatus  Called with human-readable status updates
 * @param signal    Optional AbortSignal to cancel
 */
export async function feishuQRLogin(
  onQRCode: (url: string) => void,
  onStatus: (status: 'waiting' | 'scanned' | 'done' | 'expired') => void,
  signal?: AbortSignal,
): Promise<FeishuAuthResult> {
  let base = FEISHU_BASE

  // 1. Init — confirm client_secret is supported
  const init = await registrationPost(base, { action: 'init' }) as InitResponse
  if (!init.supported_auth_methods?.includes('client_secret')) {
    throw new Error('Feishu registration does not support client_secret in this environment.')
  }

  // 2. Begin — get device_code and QR URL
  const begin = await registrationPost(base, {
    action: 'begin',
    archetype: 'PersonalAgent',
    auth_method: 'client_secret',
    request_user_info: 'open_id',
  }) as BeginResponse

  const qrUrl = new URL(begin.verification_uri_complete)
  onQRCode(qrUrl.toString())
  onStatus('waiting')

  // 3. Poll until confirmed or expired
  const deadline = Date.now() + (begin.expire_in ?? 600) * 1000
  const intervalMs = (begin.interval ?? 5) * 1000
  let domainSwitched = false

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Feishu login cancelled')
    await sleep(intervalMs)

    const poll = await registrationPost(base, {
      action: 'poll',
      device_code: begin.device_code,
    }) as PollResponse

    // Detect Lark (international) vs Feishu (China) and switch base URL once
    const brand = poll.user_info?.tenant_brand
    if (brand && !domainSwitched) {
      const isLark = brand === 'lark'
      base = isLark ? LARK_BASE : FEISHU_BASE
      domainSwitched = true
      if (isLark) continue // re-poll with correct domain
    }

    if (poll.client_id && poll.client_secret) {
      onStatus('done')
      return {
        appId: poll.client_id,
        appSecret: poll.client_secret,
        domain: (brand === 'lark') ? 'lark' : 'feishu',
        userOpenId: poll.user_info?.open_id,
      }
    }

    if (poll.error === 'authorization_pending') {
      // Still waiting — normal, keep polling
      continue
    }

    if (poll.error === 'slow_down') {
      await sleep(intervalMs) // extra back-off
      continue
    }

    if (poll.error === 'expired_token' || poll.error === 'access_denied') {
      onStatus('expired')
      throw new Error(`Feishu QR code ${poll.error}. Please run imcc again.`)
    }
  }

  onStatus('expired')
  throw new Error('Feishu QR code expired. Please run imcc again.')
}
