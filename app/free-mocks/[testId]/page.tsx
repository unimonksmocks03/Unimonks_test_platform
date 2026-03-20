import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'

import { FreeMockStartCard } from '@/components/marketing/free-mock-start-card'
import { PublicShell } from '@/components/marketing/public-shell'
import { Button } from '@/components/ui/button'
import {
    PUBLIC_LEAD_COOKIE_NAME,
    verifyPublicLeadAccessToken,
} from '@/lib/services/lead-capture-service'
import { getPublicFreeTestDetail } from '@/lib/services/free-test-service'

export const dynamic = 'force-dynamic'

type PageParams = {
    params: Promise<{ testId: string }>
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
    const { testId } = await params
    const detail = await getPublicFreeTestDetail(testId)

    if ('error' in detail) {
        return {
            title: 'Free Mock | UNIMONKS CUET Coaching',
            robots: {
                index: false,
                follow: true,
            },
        }
    }

    const title = `${detail.test.title} | Free CUET Mock | UNIMONKS`
    const description = detail.test.description || `Start the free public attempt for ${detail.test.title} on UNIMONKS CUET Coaching.`

    return {
        title,
        description,
        alternates: {
            canonical: `/free-mocks/${detail.test.id}`,
        },
        openGraph: {
            title,
            description,
            url: `/free-mocks/${detail.test.id}`,
        },
        twitter: {
            title,
            description,
        },
    }
}

export default async function FreeMockDetailPage({ params }: PageParams) {
    const { testId } = await params
    const cookieStore = await cookies()
    const leadToken = cookieStore.get(PUBLIC_LEAD_COOKIE_NAME)?.value
    const leadId = leadToken ? verifyPublicLeadAccessToken(leadToken)?.leadId ?? null : null
    const detail = await getPublicFreeTestDetail(testId, leadId)

    if ('error' in detail) {
        notFound()
    }

    return (
        <PublicShell>
            <section className="mx-auto max-w-7xl px-4 pb-18 pt-10 sm:px-6 lg:px-8">
                <Button asChild variant="ghost" className="mb-8 rounded-2xl bg-white hover:bg-slate-100">
                    <Link href="/free-mocks">
                        <ArrowLeft className="h-4 w-4" />
                        Back to Catalog
                    </Link>
                </Button>

                <div className="mb-10 space-y-4">
                    <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                        Public free mock
                    </div>
                    <h1 className="font-serif text-5xl font-bold tracking-tight text-slate-950">
                        {detail.test.title}
                    </h1>
                    <p className="max-w-3xl text-lg leading-8 text-slate-600">
                        Free users submit lead details first, attempt the mock once, and receive a public result page after submission. Enrolled students should use login instead of this route.
                    </p>
                </div>

                <FreeMockStartCard
                    test={{
                        ...detail.test,
                        updatedAt: detail.test.updatedAt.toISOString(),
                    }}
                    leadAttempt={detail.leadAttempt}
                />
            </section>
        </PublicShell>
    )
}
