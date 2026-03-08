import { Ratelimit } from "@upstash/ratelimit"
import { redis } from "./redis"

type LimitResult = { success: boolean }

function allowAll() {
  return {
    limit: async () => ({ success: true } as LimitResult)
  }
}

export const searchRL = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      prefix: "rl_search"
    })
  : allowAll()

export const resumeRL = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "rl_resume"
    })
  : allowAll()
