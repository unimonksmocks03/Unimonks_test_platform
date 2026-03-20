import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Lock } from 'lucide-react'

import { PublicShell } from '@/components/marketing/public-shell'
import { TestCard } from '@/components/marketing/test-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { listPublicMockCatalog } from '@/lib/services/free-test-service'

export const dynamic = 'force-dynamic'

const pageTitle = 'Free CUET Mock Catalog | UNIMONKS CUET Coaching'
const pageDescription = 'Browse the live public CUET mocks at UNIMONKS, start a single free attempt, and preview the locked premium practice lane.'

export const metadata: Metadata = {
    title: pageTitle,
    description: pageDescription,
    alternates: {
        canonical: '/free-mocks',
    },
    openGraph: {
        title: pageTitle,
        description: pageDescription,
        url: '/free-mocks',
    },
    twitter: {
        title: pageTitle,
        description: pageDescription,
    },
}

export default async function FreeMocksPage() {
    const catalog = await listPublicMockCatalog()

    return (
        <PublicShell>
            <section className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8">
                <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
                    <div className="space-y-5">
                        <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                            Public free mock catalog
                        </div>
                        <h1 className="font-serif text-5xl font-bold tracking-tight text-slate-950">
                            Pick a live CUET mock and use your one free attempt well.
                        </h1>
                        <p className="max-w-3xl text-lg leading-8 text-slate-600">
                            Every mock listed here belongs to the free public lane. You submit your details, take a single
                            timed attempt, and receive a result page immediately after submission.
                        </p>
                    </div>

                    <Card className="border-0 bg-[linear-gradient(135deg,#0f172a_0%,#134e4a_100%)] text-white">
                        <CardContent className="space-y-4 p-6">
                            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200">
                                Premium remains locked
                            </div>
                            <p className="text-sm leading-7 text-white/78">
                                Paid mocks stay visible, but anonymous visitors cannot enter them from this catalog.
                            </p>
                            <Button asChild className="w-full rounded-2xl bg-white text-slate-950 hover:bg-white/90">
                                <Link href="/#contact">
                                    Ask About Enrollment
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </section>

            <section className="mx-auto max-w-7xl px-4 pb-18 sm:px-6 lg:px-8">
                <div className="mb-8 flex items-center justify-between gap-4">
                    <div>
                        <h2 className="font-serif text-3xl font-bold text-slate-950">Live free mocks</h2>
                        <p className="mt-2 text-sm leading-7 text-slate-600">
                            Public catalog only. Paid tests do not open through this route.
                        </p>
                    </div>
                </div>

                {catalog.freeTests.length > 0 ? (
                    <div className="grid gap-6 lg:grid-cols-3">
                        {catalog.freeTests.map((test) => (
                            <TestCard
                                key={test.id}
                                test={test}
                                variant="free"
                                href={`/free-mocks/${test.id}`}
                            />
                        ))}
                    </div>
                ) : (
                    <Card className="border-0 bg-white">
                        <CardContent className="space-y-3 p-8">
                            <h3 className="font-serif text-3xl font-bold text-slate-950">No public mock is live right now.</h3>
                            <p className="max-w-2xl text-base leading-7 text-slate-600">
                                The free lane is active, but there is nothing published at this exact moment. Check back shortly or login if you are already enrolled.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </section>

            <section id="premium" className="bg-[#10303a] py-18 text-white">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="mb-8 space-y-3">
                        <div className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-200">
                            Locked premium preview
                        </div>
                        <h2 className="font-serif text-4xl font-bold">Visible enough to understand. Locked enough to stay premium.</h2>
                    </div>

                    {catalog.premiumTests.length > 0 ? (
                        <div className="grid gap-6 lg:grid-cols-3">
                            {catalog.premiumTests.map((test) => (
                                <TestCard
                                    key={test.id}
                                    test={test}
                                    variant="premium"
                                    ctaHref="/#contact"
                                />
                            ))}
                        </div>
                    ) : (
                        <Card className="border-0 bg-white/10 text-white">
                            <CardContent className="space-y-4 p-8">
                                <Lock className="h-7 w-7 text-amber-200" />
                                <h3 className="font-serif text-3xl font-bold">Premium mocks stay inside the enrolled batch system.</h3>
                                <p className="max-w-3xl text-base leading-7 text-white/78">
                                    This public preview stays intentionally thin even when no premium items are surfaced from the current catalog. Use the free mocks first, then move into enrollment for the full batch lane.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </section>
        </PublicShell>
    )
}
