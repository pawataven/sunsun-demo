import { randomBytes } from 'node:crypto'

const ACCESS_TOKEN_BYTES = 16
const ACCESS_TOKEN_PATTERN = /^[\w-]{22,64}$/

export function generateAccessToken() {
  return randomBytes(ACCESS_TOKEN_BYTES).toString('base64url')
}

export function isAccessTokenFormat(value: string | undefined): value is string {
  return value !== undefined && ACCESS_TOKEN_PATTERN.test(value)
}
