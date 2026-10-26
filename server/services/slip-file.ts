// EasySlip accepts images up to 4 MB; the request limit leaves room for multipart overhead.
export const MAX_SLIP_FILE_BYTES = 4 * 1024 * 1024
export const MAX_SLIP_REQUEST_BYTES = 4.5 * 1024 * 1024

export type SlipImageType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface MultipartPart {
  name?: string
  filename?: string
  type?: string
  data: Uint8Array
}

export type SlipImageCheck =
  | { ok: true, image: Uint8Array<ArrayBuffer>, mimeType: SlipImageType }
  | { ok: false }

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const JPEG_SIGNATURE = [0xFF, 0xD8, 0xFF]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return bytes.length >= offset + signature.length
    && signature.every((byte, index) => bytes[offset + index] === byte)
}

export function detectSlipImageType(bytes: Uint8Array): SlipImageType | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg'
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, 8)) return 'image/webp'
  return null
}

export function parseContentLength(header: string | undefined): number | null {
  return header && /^\d+$/.test(header) ? Number(header) : null
}

export function extractSlipImage(parts: MultipartPart[] | undefined): SlipImageCheck {
  if (!parts || parts.length !== 1) return { ok: false }

  const [part] = parts
  if (!part || part.name !== 'slip' || !part.filename) return { ok: false }
  if (part.data.length === 0 || part.data.length > MAX_SLIP_FILE_BYTES) return { ok: false }

  const mimeType = detectSlipImageType(part.data)
  if (!mimeType) return { ok: false }

  return { ok: true, image: new Uint8Array(part.data), mimeType }
}
