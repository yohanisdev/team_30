import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Variables already present in the process environment (hosting platform, test runner) win.
loadEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const booleanString = z
  .enum(['true', 'false'], { error: 'Use true or false' })
  .transform((value) => value === 'true');

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const originList = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(',').map((origin) => origin.trim().replace(/\/+$/, '')))
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1));

/** `false`, `true`, or a hop count. A hop count is the safe choice behind known proxies. */
const trustProxy = z
  .string()
  .trim()
  .default('false')
  .transform((value, ctx) => {
    if (value === 'false') return false;
    if (value === 'true') return true;
    const hops = Number(value);
    if (Number.isInteger(hops) && hops >= 0 && hops <= 10) return hops;
    ctx.addIssue({ code: 'custom', message: 'Use false, true or a number of proxy hops' });
    return z.NEVER;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 90)
      .default(60 * 60 * 24 * 14),
    FRONTEND_ORIGIN: originList,
    COOKIE_SECURE: booleanString.optional(),
    TRUST_PROXY: trustProxy,
    RATE_LIMIT_ENABLED: booleanString.default(true),

    STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
    LOCAL_STORAGE_DIR: z
      .string()
      .trim()
      .default(fileURLToPath(new URL('../../storage', import.meta.url))),
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,
    CLOUDINARY_FOLDER: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, dashes or underscores')
      .default('marketplace'),

    // Server-only. Never exposed as a VITE_ variable.
    GEMINI_API_KEY: optionalString,
    GEMINI_MODEL: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]+$/, 'Use a Gemini model id')
      .default('gemini-3.8-flash'),
    /**
     * Optional connection for the assistant's catalog reader. When set, that reader uses this
     * database role instead of the application role. The role should only be able to read the
     * public catalog. When unset, the reader still uses fixed queries on the application connection.
     */
    DATABASE_URL_CATALOG_RO: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 'cloudinary') {
      for (const key of [
        'CLOUDINARY_CLOUD_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_API_SECRET',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Required when STORAGE_DRIVER=cloudinary',
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'Production must use cloudinary: the host disk is wiped on every deploy',
      });
    }
  })
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Only variable names and rule messages are printed, never the values.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return Object.freeze(result.data);
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
