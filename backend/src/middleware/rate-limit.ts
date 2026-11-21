import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';
import { env } from '../config/env.js';

const MINUTE = 60_000;

const base: Partial<Options> = {
  windowMs: MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => !env.RATE_LIMIT_ENABLED,
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      data: null,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
      meta: {},
    });
  },
};

/*
 * Per-IP limits are looser than the security document's targets because a venue or
 * campus network puts many people behind one public IP. Per-account limits stay strict.
 */
export const loginIpLimiter = rateLimit({ ...base, limit: 30 });

export const loginAccountLimiter = rateLimit({
  ...base,
  limit: 10,
  keyGenerator: (req) => {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    return `${ipKeyGenerator(req.ip ?? 'unknown')}|${username.trim().toLowerCase().slice(0, 30)}`;
  },
});

export const registerLimiter = rateLimit({ ...base, limit: 10 });

export const refreshLimiter = rateLimit({ ...base, limit: 60 });

/** Must run after `authenticate`. */
export const uploadLimiter = rateLimit({
  ...base,
  limit: 10,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

export const apiLimiter = rateLimit({ ...base, limit: 300 });

/** Public shopping assistant. The security spec targets 20 chat requests per minute per IP. */
export const assistantLimiter = rateLimit({ ...base, limit: 20 });
