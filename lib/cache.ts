import { redis } from "./redis"

type MemoryEntry = { value: any; expiresAt: number }
const memoryCache = new Map<string, MemoryEntry>()

function nowMs() {
  return Date.now()
}

export const cache = {
  get: async (k: string) => {
    if (!redis) {
      const entry = memoryCache.get(k)
      if (!entry) return null
      if (entry.expiresAt <= nowMs()) {
        memoryCache.delete(k)
        return null
      }
      return entry.value
    }
    try {
      const v = await redis.get(k)
      return v ? JSON.parse(v as string) : null
    } catch {
      return null
    }
  },
  set: async (k: string, v: any, ttl = 120) => {
    if (!redis) {
      memoryCache.set(k, { value: v, expiresAt: nowMs() + ttl * 1000 })
      return
    }
    try {
      await redis.setex(k, ttl, JSON.stringify(v))
    } catch {
      return
    }
  },
  del: async (k: string) => {
    if (!redis) {
      memoryCache.delete(k)
      return
    }
    try {
      await redis.del(k)
    } catch {
      return
    }
  }
}
