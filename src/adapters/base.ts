/** Called with (userId, messageText), returns the reply text (or empty string). */
export type MessageHandler = (userId: string, text: string) => Promise<string>

export interface Adapter {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: MessageHandler): void
  sendMessage(userId: string, text: string): Promise<void>
}
