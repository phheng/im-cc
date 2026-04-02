/**
 * Telegram MTProto user-account QR login flow.
 *
 * Uses gramjs (telegram npm package) to authenticate as a Telegram user
 * by displaying a QR code in the terminal and scanning it with the Telegram
 * mobile app — no @BotFather or manual token entry required.
 *
 * Credentials (apiId + apiHash) must be obtained once from:
 *   https://my.telegram.org → API development tools
 *
 * Flow (mirrors feishu-auth.ts):
 *   1. connect — establish MTProto connection
 *   2. signInUserWithQrCode — display QR, await scan + confirm
 *   3. return serialized session string (saved to config for restart)
 */
import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StringSessionAny = StringSession & { save(): string }
import type { TelegramUserConfig } from './config.js'

export interface TelegramUserAuthInput {
  apiId: number
  apiHash: string
  /** 2FA password — required only if the account has Two-Step Verification enabled */
  twoFAPassword?: string
}

export type TelegramUserLoginStatus = 'waiting' | 'done' | 'expired'

/**
 * Run the Telegram user-account QR login flow.
 *
 * @param input       API credentials + optional 2FA password
 * @param onQRCode    Called with a `tg://login?token=...` URL to render as QR
 * @param onStatus    Called with status updates during the flow
 * @param signal      Optional AbortSignal to cancel the flow
 */
export async function telegramUserQRLogin(
  input: TelegramUserAuthInput,
  onQRCode: (url: string) => Promise<void> | void,
  onStatus: (status: TelegramUserLoginStatus) => void,
  signal?: AbortSignal,
): Promise<TelegramUserConfig> {
  const stringSession = new StringSession('') as StringSessionAny
  const client = new TelegramClient(
    stringSession,
    input.apiId,
    input.apiHash,
    { connectionRetries: 5 },
  )

  return new Promise<TelegramUserConfig>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Telegram login cancelled'))
      return
    }

    const onAbort = () => {
      void client.disconnect()
      reject(new Error('Telegram login cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    let firstQR = true

    client.connect()
      .then(() =>
        client.signInUserWithQrCode(
          { apiId: input.apiId, apiHash: input.apiHash },
          {
            qrCode: async (qrCode: { token: Buffer }) => {
              if (signal?.aborted) throw new Error('Telegram login cancelled')
              const url = `tg://login?token=${qrCode.token.toString('base64url')}`
              await onQRCode(url)
              if (firstQR) {
                onStatus('waiting')
                firstQR = false
              }
            },

            password: async (_hint?: string) => {
              if (input.twoFAPassword) return input.twoFAPassword
              throw new Error(
                '2FA is enabled on this account but no password was provided.\n' +
                'Run `imcc telegram-login` and answer yes when asked about 2FA.',
              )
            },

            onError: async (err: Error) => {
              reject(err)
              return true  // tell gramjs to stop retrying
            },
          },
        ),
      )
      .then(() => {
        onStatus('done')
        const session = stringSession.save()
        resolve({
          apiId: input.apiId,
          apiHash: input.apiHash,
          session,
          twoFAPassword: input.twoFAPassword,
        })
      })
      .catch((err: Error) => {
        reject(err)
      })
      .finally(() => {
        signal?.removeEventListener('abort', onAbort)
      })
  })
}
