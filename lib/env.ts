import { z } from 'zod'

const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development')
const nonEmptyString = z.string().trim().min(1)
const postgresUrlSchema = nonEmptyString.refine(
    (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
    { message: 'must be a PostgreSQL connection string' }
)
const redisUrlSchema = nonEmptyString.refine(
    (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
    { message: 'must be a Redis connection string' }
)
const httpUrlSchema = z.string().trim().url()

type DatabaseEnv = {
    DATABASE_URL: string
    DIRECT_URL: string
}

type RedisEnv =
    | {
        mode: 'upstash'
        restUrl: string
        restToken: string
        nodeEnv: 'development' | 'test' | 'production'
    }
    | {
        mode: 'tcp'
        redisUrl: string
        nodeEnv: 'development' | 'test' | 'production'
    }

type AuthEnv = {
    JWT_SECRET: string
    JWT_REFRESH_SECRET: string
}

type AppEnv = {
    NEXT_PUBLIC_APP_URL: string
    NODE_ENV: 'development' | 'test' | 'production'
}

type EmailEnv = {
    gmailUser: string
    gmailAppPassword: string
    enableDevOtpLogs: boolean
}

type QStashEnv =
    | {
        mode: 'local'
        baseUrl: string
    }
    | {
        mode: 'production'
        token: string
        currentSigningKey: string
        nextSigningKey: string
        baseUrl?: string
    }

let databaseEnvCache: DatabaseEnv | null = null
let redisEnvCache: RedisEnv | null = null
let authEnvCache: AuthEnv | null = null
let appEnvCache: AppEnv | null = null
let emailEnvCache: EmailEnv | null = null
let qstashEnvCache: QStashEnv | null = null

function formatEnvIssues(scope: string, issues: { path: PropertyKey[]; message: string }[]) {
    const detail = issues
        .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')

    return `[env:${scope}] Invalid environment configuration\n${detail}`
}

function isNeonHost(hostname: string) {
    return hostname.includes('neon.tech')
}

function assertNeonServerlessConfig(env: DatabaseEnv) {
    const runtimeUrl = new URL(env.DATABASE_URL)
    const directUrl = new URL(env.DIRECT_URL)

    if (isNeonHost(runtimeUrl.hostname) && !runtimeUrl.hostname.includes('-pooler.')) {
        throw new Error(
            '[env:database] DATABASE_URL must use the Neon pooled host when deploying on serverless.'
        )
    }

    if (isNeonHost(directUrl.hostname) && directUrl.hostname.includes('-pooler.')) {
        throw new Error(
            '[env:database] DIRECT_URL must use the Neon direct host, not the pooled host.'
        )
    }
}

export function getDatabaseEnv(): DatabaseEnv {
    if (databaseEnvCache) {
        return databaseEnvCache
    }

    const schema = z.object({
        DATABASE_URL: postgresUrlSchema,
        DIRECT_URL: postgresUrlSchema,
    })

    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(formatEnvIssues('database', parsed.error.issues))
    }

    assertNeonServerlessConfig(parsed.data)
    databaseEnvCache = parsed.data
    return databaseEnvCache
}

export function getRedisEnv(): RedisEnv {
    if (redisEnvCache) {
        return redisEnvCache
    }

    const schema = z.object({
        NODE_ENV: nodeEnvSchema,
        REDIS_URL: redisUrlSchema.optional(),
        UPSTASH_REDIS_REST_URL: httpUrlSchema.optional(),
        UPSTASH_REDIS_REST_TOKEN: nonEmptyString.optional(),
    }).superRefine((env, ctx) => {
        const hasRestUrl = !!env.UPSTASH_REDIS_REST_URL
        const hasRestToken = !!env.UPSTASH_REDIS_REST_TOKEN

        if (hasRestUrl !== hasRestToken) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be provided together.',
                path: hasRestUrl ? ['UPSTASH_REDIS_REST_TOKEN'] : ['UPSTASH_REDIS_REST_URL'],
            })
        }

        if (!hasRestUrl && !env.REDIS_URL) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Provide either UPSTASH_REDIS_REST_* for Vercel/Upstash or REDIS_URL for local Redis.',
                path: ['REDIS_URL'],
            })
        }
    })

    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(formatEnvIssues('redis', parsed.error.issues))
    }

    if (parsed.data.UPSTASH_REDIS_REST_URL && parsed.data.UPSTASH_REDIS_REST_TOKEN) {
        redisEnvCache = {
            mode: 'upstash',
            restUrl: parsed.data.UPSTASH_REDIS_REST_URL,
            restToken: parsed.data.UPSTASH_REDIS_REST_TOKEN,
            nodeEnv: parsed.data.NODE_ENV,
        }

        return redisEnvCache
    }

    redisEnvCache = {
        mode: 'tcp',
        redisUrl: parsed.data.REDIS_URL!,
        nodeEnv: parsed.data.NODE_ENV,
    }

    return redisEnvCache
}

export function getAuthEnv(): AuthEnv {
    if (authEnvCache) {
        return authEnvCache
    }

    const schema = z.object({
        JWT_SECRET: nonEmptyString,
        JWT_REFRESH_SECRET: nonEmptyString,
    })

    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(formatEnvIssues('auth', parsed.error.issues))
    }

    authEnvCache = parsed.data
    return authEnvCache
}

export function getAppEnv(): AppEnv {
    if (appEnvCache) {
        return appEnvCache
    }

    const schema = z.object({
        NEXT_PUBLIC_APP_URL: httpUrlSchema,
        NODE_ENV: nodeEnvSchema,
    })

    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(formatEnvIssues('app', parsed.error.issues))
    }

    appEnvCache = parsed.data
    return appEnvCache
}

export function getEmailEnv(): EmailEnv {
    if (emailEnvCache) {
        return emailEnvCache
    }

    const schema = z.object({
        GMAIL_USER: nonEmptyString,
        GMAIL_APP_PASSWORD: nonEmptyString,
        ENABLE_DEV_OTP_LOGS: z.enum(['true', 'false']).optional().default('false'),
    })

    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
        throw new Error(formatEnvIssues('email', parsed.error.issues))
    }

    emailEnvCache = {
        gmailUser: parsed.data.GMAIL_USER,
        gmailAppPassword: parsed.data.GMAIL_APP_PASSWORD,
        enableDevOtpLogs: parsed.data.ENABLE_DEV_OTP_LOGS === 'true',
    }

    return emailEnvCache
}

export function getQStashEnv(): QStashEnv {
    if (qstashEnvCache) {
        return qstashEnvCache
    }

    const productionParsed = z.object({
        QSTASH_TOKEN: nonEmptyString.optional(),
        QSTASH_CURRENT_SIGNING_KEY: nonEmptyString.optional(),
        QSTASH_NEXT_SIGNING_KEY: nonEmptyString.optional(),
        QSTASH_URL: httpUrlSchema.optional(),
    }).safeParse(process.env)

    if (!productionParsed.success) {
        throw new Error(formatEnvIssues('qstash', productionParsed.error.issues))
    }

    const hasProductionToken = !!productionParsed.data.QSTASH_TOKEN
    const hasSigningKeys = !!productionParsed.data.QSTASH_CURRENT_SIGNING_KEY && !!productionParsed.data.QSTASH_NEXT_SIGNING_KEY

    if (hasProductionToken || hasSigningKeys) {
        const parsed = z.object({
            QSTASH_TOKEN: nonEmptyString,
            QSTASH_CURRENT_SIGNING_KEY: nonEmptyString,
            QSTASH_NEXT_SIGNING_KEY: nonEmptyString,
            QSTASH_URL: httpUrlSchema.optional(),
        }).safeParse(process.env)

        if (!parsed.success) {
            throw new Error(formatEnvIssues('qstash', parsed.error.issues))
        }

        qstashEnvCache = {
            mode: 'production',
            token: parsed.data.QSTASH_TOKEN,
            currentSigningKey: parsed.data.QSTASH_CURRENT_SIGNING_KEY,
            nextSigningKey: parsed.data.QSTASH_NEXT_SIGNING_KEY,
            baseUrl: parsed.data.QSTASH_URL,
        }

        return qstashEnvCache
    }

    if (productionParsed.data.QSTASH_URL) {
        qstashEnvCache = {
            mode: 'local',
            baseUrl: productionParsed.data.QSTASH_URL,
        }

        return qstashEnvCache
    }

    throw new Error(
        '[env:qstash] Invalid environment configuration\n- QSTASH_TOKEN, QSTASH_CURRENT_SIGNING_KEY, and QSTASH_NEXT_SIGNING_KEY are required for production, or set only QSTASH_URL for local mode.'
    )
}
