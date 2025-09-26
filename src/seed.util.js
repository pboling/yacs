// Seed utility: derives a base seed from environment or a .seed file.
// Priority:
// 1) process.env.VITE_SEED
// 2) process.env.SEED
// 3) project-root .seed file (first integer on first line)
// 4) fallback constant

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEFAULT_SEED = 0xc0ffee

function toUInt32(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return undefined
  return x >>> 0
}

export function getBaseSeed() {
  // Use globalThis.process to avoid relying on @types/node in TS builds.
  const env = globalThis /** @type {any} */.process?.env ?? {}
  const fromEnv = env.VITE_SEED ?? env.SEED
  const parsedEnv = toUInt32(fromEnv)
  if (parsedEnv !== undefined) return parsedEnv
  try {
    const p = resolve(process.cwd(), '.seed')
    const txt = readFileSync(p, 'utf8')
    const m = txt.match(/-?\d+/)
    if (m) {
      const parsed = toUInt32(m[0])
      if (parsed !== undefined) return parsed
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SEED >>> 0
}

export function mixSeeds(a, b) {
  // Xorshift-like simple mix; ensure uint32
  const x = (a >>> 0) ^ (b >>> 0)
  // avalanche
  let y = x + 0x7ed55d16 + (x << 12)
  y ^= 0xc761c23c ^ (y >>> 19)
  y += 0x165667b1 + (y << 5)
  y ^= 0xd3a2646c ^ (y << 9)
  y += 0xfd7046c5 + (y << 3)
  y ^= 0xb55a4f09 ^ (y >>> 16)
  return y >>> 0
}
