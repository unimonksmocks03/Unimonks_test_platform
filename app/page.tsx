import type { Metadata } from 'next'

import { LandingPage, landingFaqItems } from '@/components/marketing/landing-page'
import { listPublicMockCatalog } from '@/lib/services/free-test-service'

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const homeTitle = 'UNIMONKS CUET Coaching | Free CUET Mock Tests and Premium Prep'
const homeDescription = 'Discover UNIMONKS CUET Coaching, start a free public mock test with lead capture, and move into premium batch-based practice when you are ready.'

export const metadata: Metadata = {
    title: homeTitle,
    description: homeDescription,
    alternates: {
        canonical: '/',
    },
    openGraph: {
        title: homeTitle,
        description: homeDescription,
        url: '/',
    },
    twitter: {
        title: homeTitle,
        description: homeDescription,
    },
}

export default async function Home() {
    const catalog = await listPublicMockCatalog()
    const structuredData = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'EducationalOrganization',
                '@id': `${siteUrl}/#organization`,
                name: 'UNIMONKS CUET Coaching',
                url: siteUrl,
                description: homeDescription,
                areaServed: 'India',
                knowsAbout: ['CUET preparation', 'CUET mock tests', 'Batch-based test practice'],
            },
            {
                '@type': 'WebSite',
                '@id': `${siteUrl}/#website`,
                url: siteUrl,
                name: 'UNIMONKS CUET Coaching',
                description: homeDescription,
            },
            {
                '@type': 'FAQPage',
                '@id': `${siteUrl}/#faq`,
                mainEntity: landingFaqItems.map((item) => ({
                    '@type': 'Question',
                    name: item.question,
                    acceptedAnswer: {
                        '@type': 'Answer',
                        text: item.answer,
                    },
                })),
            },
        ],
    }

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
            />
            <LandingPage catalog={catalog} />
        </>
    )
}
