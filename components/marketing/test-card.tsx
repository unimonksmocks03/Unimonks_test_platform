import Link from 'next/link'
import { ArrowRight, Clock3, Layers3, Lock } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

type TestCardData = {
    id: string
    title: string
    description: string | null
    durationMinutes: number
    questionCount: number
}

type TestCardProps = {
    test: TestCardData
    variant: 'free' | 'premium'
    href?: string
    ctaHref?: string
    ctaLabel?: string
}

export function TestCard({
    test,
    variant,
    href,
    ctaHref = href,
    ctaLabel,
}: TestCardProps) {
    const isLocked = variant === 'premium'
    const label = ctaLabel ?? (isLocked ? 'Unlock with Enrollment' : 'Open Free Mock')
    const Icon = isLocked ? Lock : ArrowRight

    return (
        <Card
            className={`h-full overflow-hidden border-0 ${
                isLocked
                    ? 'bg-[linear-gradient(180deg,#12343b_0%,#0d2329_100%)] text-white'
                    : 'bg-white'
            } ${href && !isLocked ? 'transition-transform hover:-translate-y-1' : ''}`}
        >
            <CardHeader className="gap-4 border-b border-white/10 pb-6">
                <div className="flex items-start justify-between gap-4">
                    <Badge
                        className={`rounded-full border-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] ${
                            isLocked
                                ? 'bg-white/12 text-white'
                                : 'bg-emerald-100 text-emerald-800'
                        }`}
                    >
                        {isLocked ? 'Premium Locked' : 'Free Mock'}
                    </Badge>
                    {isLocked ? <Lock className="h-5 w-5 text-white/70" /> : null}
                </div>
                <div className="space-y-3">
                    <CardTitle className={`text-2xl font-serif font-bold ${isLocked ? 'text-white' : 'text-slate-900'}`}>
                        {test.title}
                    </CardTitle>
                    <p className={`line-clamp-3 text-sm leading-6 ${isLocked ? 'text-white/76' : 'text-slate-600'}`}>
                        {test.description || (
                            isLocked
                                ? 'Reserved for enrolled students inside their assigned premium batch.'
                                : 'Start a public CUET mock, get your score instantly, and see where you stand before enrolling.'
                        )}
                    </p>
                </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-6">
                <div className="flex items-center gap-3 rounded-2xl bg-black/5 px-4 py-3 text-sm font-medium text-inherit">
                    <Clock3 className={`h-4 w-4 ${isLocked ? 'text-amber-300' : 'text-amber-600'}`} />
                    <span>{test.durationMinutes} minute timer</span>
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-black/5 px-4 py-3 text-sm font-medium text-inherit">
                    <Layers3 className={`h-4 w-4 ${isLocked ? 'text-teal-200' : 'text-teal-700'}`} />
                    <span>{test.questionCount} multiple-choice questions</span>
                </div>
            </CardContent>
            <CardFooter className="pt-2">
                {ctaHref ? (
                    <Button
                        asChild
                        className={`h-12 w-full rounded-2xl text-sm font-semibold ${
                            isLocked
                                ? 'bg-white text-slate-900 hover:bg-white/90'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                        }`}
                    >
                        <Link href={ctaHref}>
                            {label}
                            <Icon className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                ) : (
                    <Button
                        disabled
                        className={`h-12 w-full rounded-2xl text-sm font-semibold ${
                            isLocked
                                ? 'bg-white/15 text-white'
                                : 'bg-slate-900 text-white'
                        }`}
                    >
                        {label}
                    </Button>
                )}
            </CardFooter>
        </Card>
    )
}
