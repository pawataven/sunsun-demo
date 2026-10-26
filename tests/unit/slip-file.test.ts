import { describe, expect, it } from 'vitest'
import { detectSlipImageType, extractSlipImage, MAX_SLIP_FILE_BYTES, parseContentLength } from '../../server/services/slip-file'
import { PNG_BYTES, slipPart } from '../fixtures/easyslip'

const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const HTML_BYTES = new TextEncoder().encode('<html><script>alert(1)</script></html>')

describe('detectSlipImageType', () => {
  it.each([
    ['JPEG', JPEG_BYTES, 'image/jpeg'],
    ['PNG', PNG_BYTES, 'image/png'],
    ['WebP', WEBP_BYTES, 'image/webp']
  ])('recognises %s from its magic bytes', (_, bytes, type) => {
    expect(detectSlipImageType(bytes)).toBe(type)
  })

  it('rejects a RIFF file that is not WebP', () => {
    const wave = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
    expect(detectSlipImageType(wave)).toBeNull()
  })

  it('rejects GIF even though EasySlip accepts it', () => {
    expect(detectSlipImageType(new TextEncoder().encode('GIF89a'))).toBeNull()
  })
})

describe('extractSlipImage', () => {
  it('accepts one image in the slip field', () => {
    expect(extractSlipImage([slipPart()])).toMatchObject({ ok: true, mimeType: 'image/png' })
  })

  it('trusts the bytes, not the claimed type or extension', () => {
    expect(extractSlipImage([slipPart({ filename: 'slip.jpg', type: 'image/jpeg', data: HTML_BYTES })])).toEqual({ ok: false })
  })

  it('rejects more than one part', () => {
    expect(extractSlipImage([slipPart(), slipPart()])).toEqual({ ok: false })
  })

  it('rejects extra form fields', () => {
    expect(extractSlipImage([slipPart(), { name: 'amount', data: new TextEncoder().encode('1') }])).toEqual({ ok: false })
  })

  it('rejects a file under any other field name', () => {
    expect(extractSlipImage([slipPart({ name: 'image' })])).toEqual({ ok: false })
  })

  it('rejects a field that is not a file', () => {
    expect(extractSlipImage([slipPart({ filename: undefined })])).toEqual({ ok: false })
  })

  it('rejects files over 4 MB', () => {
    const tooLarge = new Uint8Array(MAX_SLIP_FILE_BYTES + 1)
    tooLarge.set(PNG_BYTES)
    expect(extractSlipImage([slipPart({ data: tooLarge })])).toEqual({ ok: false })
  })

  it('rejects an empty body', () => {
    expect(extractSlipImage(undefined)).toEqual({ ok: false })
  })
})

describe('parseContentLength', () => {
  it.each([
    ['1024', 1024],
    [undefined, null],
    ['', null],
    ['12abc', null],
    ['-1', null]
  ])('parses %j as %j', (header, expected) => {
    expect(parseContentLength(header)).toBe(expected)
  })
})
