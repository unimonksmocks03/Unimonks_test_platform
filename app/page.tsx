import type { Metadata } from 'next'

import { LandingPage, landingFaqItems } from '@/components/marketing/landing-page'
import { UNIMONKS_BRAND, UNIMONKS_CONTACT } from '@/lib/config/unimonks'
import { listPublicMockCatalog } from '@/lib/services/free-test-service'

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const homeTitle = `${UNIMONKS_BRAND.displayName} | Free CUET Mock Tests and Premium Prep`
const homeDescription = `Discover ${UNIMONKS_BRAND.displayName}, start a free public mock test with lead capture, and move into premium batch-based practice when you are ready.`

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
                name: UNIMONKS_BRAND.displayName,
                url: siteUrl,
                logo: `${siteUrl}${UNIMONKS_BRAND.logoPath}`,
                description: homeDescription,
                email: UNIMONKS_CONTACT.email,
                telephone: UNIMONKS_CONTACT.phoneE164,
                address: UNIMONKS_CONTACT.addressStructuredData,
                areaServed: 'India',
                sameAs: [UNIMONKS_BRAND.websiteUrl],
                contactPoint: [
                    {
                        '@type': 'ContactPoint',
                        contactType: 'customer support',
                        telephone: UNIMONKS_CONTACT.phoneE164,
                        email: UNIMONKS_CONTACT.email,
                        areaServed: 'IN',
                        availableLanguage: ['en', 'hi'],
                    },
                ],
                knowsAbout: ['CUET preparation', 'CUET mock tests', 'Batch-based test practice'],
            },
            {
                '@type': 'WebSite',
                '@id': `${siteUrl}/#website`,
                url: siteUrl,
                name: UNIMONKS_BRAND.displayName,
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
