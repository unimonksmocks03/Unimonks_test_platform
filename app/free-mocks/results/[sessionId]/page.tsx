import type { Metadata } from 'next'

import { FreeTestResultClient } from '@/components/marketing/free-test-result-client'
import { PublicShell } from '@/components/marketing/public-shell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
    title: 'Free Mock Result | UNIMONKS',
    robots: {
        index: false,
        follow: false,
    },
}

export default async function FreeMockResultPage({
    params,
}: {
    params: Promise<{ sessionId: string }>
}) {
    const { sessionId } = await params

    return (
        <PublicShell>
            <section className="mx-auto max-w-7xl px-4 pb-18 pt-10 sm:px-6 lg:px-8">
                <FreeTestResultClient sessionId={sessionId} />
            </section>
        </PublicShell>
    )
}
