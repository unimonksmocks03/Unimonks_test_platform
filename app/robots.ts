import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: ['/', '/free-mocks', '/free-mocks/'],
                disallow: [
                    '/api/',
                    '/login',
                    '/admin/',
                    '/student/',
                    '/arena/',
                    '/free-mocks/session/',
                    '/free-mocks/results/',
                ],
            },
        ],
        sitemap: `${siteUrl}/sitemap.xml`,
        host: siteUrl,
    }
}
