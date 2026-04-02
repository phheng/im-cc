/**
 * Shared utilities used across adapters.
 */

/**
 * Split a long string into chunks of at most `maxLen` characters.
 * Used to stay within IM platform message size limits.
 */
export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let pos = 0
  while (pos < text.length) {
    chunks.push(text.slice(pos, pos + maxLen))
    pos += maxLen
  }
  return chunks
}
