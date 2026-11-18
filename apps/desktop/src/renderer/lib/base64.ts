/** Byte-array ⇄ base64 string, shared by anything that needs to hand opaque bytes to the host's
 *  text-only storage (`collabDocSave`) or turn them into a copyable code (skill-sharing). Goes
 *  through `TextEncoder`/`TextDecoder` rather than `btoa`/`atob` directly on a string, so content
 *  with non-Latin1 characters (Chinese skill instructions, say) round-trips correctly. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Any JSON-serializable value, packed into one opaque, copyable string (UTF-8 safe). */
export function encodeCode<T>(value: T): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))
}

/** The inverse of `encodeCode` — throws if `code` isn't one its own output produced. */
export function decodeCode<T>(code: string): T {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(code.trim()))) as T
}
