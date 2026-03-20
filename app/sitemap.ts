import type { MetadataRoute } from 'next'

import { listPublicFreeTestsForSitemap } from '@/lib/services/free-test-service'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const freeTests = await listPublicFreeTestsForSitemap()
    const now = new Date()

    return [
        {
            url: siteUrl,
            lastModified: now,
            changeFrequency: 'daily',
            priority: 1,
        },
        {
            url: `${siteUrl}/free-mocks`,
            lastModified: now,
            changeFrequency: 'daily',
            priority: 0.9,
        },
        ...freeTests.map((test) => ({
            url: `${siteUrl}/free-mocks/${test.id}`,
            lastModified: test.updatedAt,
            changeFrequency: 'daily' as const,
            priority: 0.8,
        })),
    ]
}
