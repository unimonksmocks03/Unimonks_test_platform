import { Redis as UpstashRedis } from '@upstash/redis'
import { Redis as IORedis } from 'ioredis'
import { getRedisEnv } from '@/lib/env'

type SetExpiryMode = 'EX'
type RedisScoreBoundary = number | '-inf' | '+inf' | `(${number}`
type PipelineResult = [Error | null, unknown][]

interface RedisPipeline {
    set(key: string, value: string, mode?: SetExpiryMode, ttl?: number): RedisPipeline
    del(...keys: string[]): RedisPipeline
    expire(key: string, seconds: number): RedisPipeline
    sadd(key: string, ...members: string[]): RedisPipeline
    srem(key: string, ...members: string[]): RedisPipeline
    lpush(key: string, ...elements: string[]): RedisPipeline
    lrange(key: string, start: number, stop: number): RedisPipeline
    exec(): Promise<PipelineResult | null>
}

export interface RedisClient {
    get(key: string): Promise<string | null>
    set(key: string, value: string, mode?: SetExpiryMode, ttl?: number): Promise<'OK' | string | null>
    del(...keys: string[]): Promise<number>
    expire(key: string, seconds: number): Promise<number>
    incr(key: string): Promise<number>
    ttl(key: string): Promise<number>
    smembers(key: string): Promise<string[]>
    sadd(key: string, ...members: string[]): Promise<number>
    srem(key: string, ...members: string[]): Promise<number>
    scan(
        cursor: string | number,
        matchLabel: 'MATCH',
        pattern: string,
        countLabel: 'COUNT',
        count: number
    ): Promise<[string, string[]]>
    zremrangebyscore(key: string, min: RedisScoreBoundary, max: RedisScoreBoundary): Promise<number>
    zcard(key: string): Promise<number>
    zadd(key: string, score: number, member: string): Promise<number | null>
    lpush(key: string, ...elements: string[]): Promise<number>
    lrange(key: string, start: number, stop: number): Promise<string[]>
    pipeline(): RedisPipeline
}

class IORedisPipeline implements RedisPipeline {
    constructor(private readonly pipelineClient: ReturnType<IORedis['pipeline']>) { }

    set(key: string, value: string, mode?: SetExpiryMode, ttl?: number) {
        if (mode === 'EX' && typeof ttl === 'number') {
            this.pipelineClient.set(key, value, mode, ttl)
        } else {
            this.pipelineClient.set(key, value)
        }

        return this
    }

    del(...keys: string[]) {
        this.pipelineClient.del(...keys)
        return this
    }

    expire(key: string, seconds: number) {
        this.pipelineClient.expire(key, seconds)
        return this
    }

    sadd(key: string, ...members: string[]) {
        this.pipelineClient.sadd(key, ...members)
        return this
    }

    srem(key: string, ...members: string[]) {
        this.pipelineClient.srem(key, ...members)
        return this
    }

    lpush(key: string, ...elements: string[]) {
        this.pipelineClient.lpush(key, ...elements)
        return this
    }

    lrange(key: string, start: number, stop: number) {
        this.pipelineClient.lrange(key, start, stop)
        return this
    }

    async exec() {
        return (await this.pipelineClient.exec()) ?? []
    }
}

class UpstashPipeline implements RedisPipeline {
    constructor(private readonly pipelineClient: ReturnType<UpstashRedis['pipeline']>) { }

    set(key: string, value: string, mode?: SetExpiryMode, ttl?: number) {
        if (mode === 'EX' && typeof ttl === 'number') {
            this.pipelineClient.set(key, value, { ex: ttl })
        } else {
            this.pipelineClient.set(key, value)
        }

        return this
    }

    del(...keys: string[]) {
        this.pipelineClient.del(...keys)
        return this
    }

    expire(key: string, seconds: number) {
        this.pipelineClient.expire(key, seconds)
        return this
    }

    sadd(key: string, ...members: string[]) {
        this.pipelineClient.sadd(key, members[0], ...members.slice(1))
        return this
    }

    srem(key: string, ...members: string[]) {
        this.pipelineClient.srem(key, members[0], ...members.slice(1))
        return this
    }

    lpush(key: string, ...elements: string[]) {
        this.pipelineClient.lpush(key, ...elements)
        return this
    }

    lrange(key: string, start: number, stop: number) {
        this.pipelineClient.lrange(key, start, stop)
        return this
    }

    async exec() {
        const results = await this.pipelineClient.exec({ keepErrors: true })
        return results.map((result) => [
            result.error ? new Error(result.error) : null,
            result.result,
        ]) as PipelineResult
    }
}

function createIORedisClient(redisUrl: string): RedisClient {
    const client = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
            return Math.min(times * 50, 2000)
        },
    })

    return {
        get: (key) => client.get(key),
        set: (key, value, mode, ttl) => {
            if (mode === 'EX' && typeof ttl === 'number') {
                return client.set(key, value, mode, ttl)
            }

            return client.set(key, value)
        },
        del: (...keys) => client.del(...keys),
        expire: (key, seconds) => client.expire(key, seconds),
        incr: (key) => client.incr(key),
        ttl: (key) => client.ttl(key),
        smembers: (key) => client.smembers(key),
        sadd: (key, ...members) => client.sadd(key, ...members),
        srem: (key, ...members) => client.srem(key, ...members),
        scan: (cursor, _matchLabel, pattern, _countLabel, count) => client.scan(String(cursor), 'MATCH', pattern, 'COUNT', count),
        zremrangebyscore: (key, min, max) => client.zremrangebyscore(key, min, max),
        zcard: (key) => client.zcard(key),
        zadd: (key, score, member) => client.zadd(key, score, member),
        lpush: (key, ...elements) => client.lpush(key, ...elements),
        lrange: (key, start, stop) => client.lrange(key, start, stop),
        pipeline: () => new IORedisPipeline(client.pipeline()),
    }
}

function createUpstashClient(restUrl: string, restToken: string): RedisClient {
    const client = new UpstashRedis({
        url: restUrl,
        token: restToken,
    })

    return {
        get: (key) => client.get(key),
        set: (key, value, mode, ttl) => {
            if (mode === 'EX' && typeof ttl === 'number') {
                return client.set(key, value, { ex: ttl })
            }

            return client.set(key, value)
        },
        del: (...keys) => client.del(...keys),
        expire: (key, seconds) => client.expire(key, seconds),
        incr: (key) => client.incr(key),
        ttl: (key) => client.ttl(key),
        smembers: (key) => client.smembers(key),
        sadd: (key, ...members) => client.sadd(key, members[0], ...members.slice(1)),
        srem: (key, ...members) => client.srem(key, members[0], ...members.slice(1)),
        scan: (cursor, _matchLabel, pattern, _countLabel, count) => client.scan(cursor, { match: pattern, count }),
        zremrangebyscore: (key, min, max) => client.zremrangebyscore(key, min, max),
        zcard: (key) => client.zcard(key),
        zadd: (key, score, member) => client.zadd(key, { score, member }),
        lpush: (key, ...elements) => client.lpush(key, ...elements),
        lrange: (key, start, stop) => client.lrange(key, start, stop),
        pipeline: () => new UpstashPipeline(client.pipeline()),
    }
}

function createRedisClient(): RedisClient {
    const env = getRedisEnv()

    if (env.mode === 'upstash') {
        return createUpstashClient(env.restUrl, env.restToken)
    }

    return createIORedisClient(env.redisUrl)
}

const globalForRedis = globalThis as unknown as {
    redis: RedisClient | undefined
}

export const redis = globalForRedis.redis ?? createRedisClient()

if (getRedisEnv().nodeEnv !== 'production') {
    globalForRedis.redis = redis
}
