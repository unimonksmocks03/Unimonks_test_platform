'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Lock, RotateCcw, Trophy, XCircle } from 'lucide-react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiClient } from '@/lib/api-client'

type ResultPayload = {
    session: {
        id: string
        status: string
        score: number
        totalMarks: number
        percentage: number
        submittedAt: string | null
        startedAt: string
        durationMinutes: number
    }
    test: {
        id: string
        title: string
        description: string | null
        questionCount: number
    }
    performance: {
        correctCount: number
        incorrectCount: number
        unansweredCount: number
        passingScore: number
        passed: boolean
    }
    questionReview: Array<{
        id: string
        order: number
        stem: string
        difficulty: string
        topic: string | null
        explanation: string | null
        selectedOptionId: string | null
        correctOptionId: string | null
        isCorrect: boolean
        options: Array<{
            id: string
            text: string
        }>
    }>
}

export function FreeTestResultClient({ sessionId }: { sessionId: string }) {
    const [isLoading, setIsLoading] = useState(true)
    const [errorCode, setErrorCode] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [result, setResult] = useState<ResultPayload | null>(null)

    useEffect(() => {
        let active = true

        ;(async () => {
            const response = await apiClient.get<ResultPayload>(`/api/public/free-sessions/${sessionId}/result`)

            if (!active) {
                return
            }

            if (!response.ok) {
                setErrorCode(response.code)
                setErrorMessage(response.message)
                setIsLoading(false)
                return
            }

            setResult(response.data)
            setIsLoading(false)
        })()

        return () => {
            active = false
        }
    }, [sessionId])

    if (isLoading) {
        return (
            <Card className="border-0 bg-white">
                <CardContent className="space-y-3 p-8">
                    <div className="h-8 w-56 animate-pulse rounded-full bg-slate-200" />
                    <div className="h-4 w-80 animate-pulse rounded-full bg-slate-200" />
                    <div className="h-4 w-64 animate-pulse rounded-full bg-slate-200" />
                </CardContent>
            </Card>
        )
    }

    if (!result) {
        return (
            <Card className="border-0 bg-white">
                <CardContent className="space-y-5 p-8">
                    <h2 className="font-serif text-3xl font-bold text-slate-950">Result unavailable</h2>
                    <p className="max-w-2xl text-base leading-7 text-slate-600">
                        {errorCode === 'SESSION_IN_PROGRESS'
                            ? 'Finish the free mock before opening the result page.'
                            : errorMessage || 'This result could not be loaded right now.'}
                    </p>
                    <div className="flex flex-wrap gap-3">
                        {errorCode === 'SESSION_IN_PROGRESS' ? (
                            <Button asChild className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
                                <Link href={`/free-mocks/session/${sessionId}`}>Resume Free Mock</Link>
                            </Button>
                        ) : null}
                        <Button asChild variant="ghost" className="rounded-2xl bg-slate-100 hover:bg-slate-200">
                            <Link href="/free-mocks">Back to Catalog</Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        )
    }

    const highlightTone = result.performance.passed
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-amber-100 text-amber-800'

    return (
        <div className="space-y-8">
            <Card className="overflow-hidden border-0 bg-[linear-gradient(135deg,#0f172a_0%,#134e4a_100%)] text-white">
                <CardContent className="grid gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="space-y-4">
                        <Badge className="w-fit rounded-full border-0 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white">
                            Free Mock Result
                        </Badge>
                        <h1 className="font-serif text-4xl font-bold">{result.test.title}</h1>
                        <p className="max-w-2xl text-base leading-7 text-white/78">
                            Your public attempt is complete. Use the score summary to decide whether you should keep sampling free mocks or move into the premium batch lane.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <Badge className={`rounded-full border-0 px-4 py-1.5 text-sm font-semibold ${highlightTone}`}>
                                {result.performance.passed ? 'Above target line' : 'Below target line'}
                            </Badge>
                            <Badge className="rounded-full border-0 bg-white/10 px-4 py-1.5 text-sm font-semibold text-white">
                                {result.session.status.replace('_', ' ')}
                            </Badge>
                        </div>
                    </div>

                    <div className="rounded-[28px] bg-white p-6 text-slate-950">
                        <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                            Score summary
                        </div>
                        <div className="mt-4 font-serif text-6xl font-bold">{Math.round(result.session.percentage)}%</div>
                        <div className="mt-2 text-base font-medium text-slate-600">
                            {result.session.score}/{result.session.totalMarks} correct
                        </div>
                        <div className="mt-6 rounded-[22px] bg-[#f8f4ed] px-4 py-3 text-sm font-medium text-slate-700">
                            Target line: {result.performance.passingScore}%
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-3">
                {[
                    {
                        label: 'Correct',
                        value: result.performance.correctCount,
                        tone: 'bg-emerald-100 text-emerald-800',
                        icon: CheckCircle2,
                    },
                    {
                        label: 'Incorrect',
                        value: result.performance.incorrectCount,
                        tone: 'bg-rose-100 text-rose-800',
                        icon: XCircle,
                    },
                    {
                        label: 'Unanswered',
                        value: result.performance.unansweredCount,
                        tone: 'bg-slate-100 text-slate-700',
                        icon: RotateCcw,
                    },
                ].map((item) => (
                    <Card key={item.label} className="border-0 bg-white">
                        <CardContent className="space-y-4 p-6">
                            <item.icon className="h-6 w-6 text-slate-900" />
                            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                                {item.label}
                            </div>
                            <div className="font-serif text-4xl font-bold text-slate-950">{item.value}</div>
                            <Badge className={`w-fit rounded-full border-0 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${item.tone}`}>
                                {item.label}
                            </Badge>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="border-0 bg-white">
                <CardHeader className="gap-3 border-b border-slate-200 pb-6">
                    <div className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
                        Conversion CTA
                    </div>
                    <CardTitle className="font-serif text-3xl font-bold text-slate-950">
                        Ready to unlock the premium mock lane?
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 pt-6 lg:grid-cols-3">
                    <Button asChild className="h-12 rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
                        <Link href="/#premium">
                            Unlock Premium Mocks
                            <Lock className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                    <Button asChild variant="ghost" className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200">
                        <Link href="/#contact">
                            Talk to UNIMONKS
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                    <Button asChild variant="ghost" className="h-12 rounded-2xl bg-emerald-50 text-emerald-800 hover:bg-emerald-100">
                        <Link href="/free-mocks">
                            Try Another Free Mock
                            <Trophy className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </CardContent>
            </Card>

            <Card className="border-0 bg-white">
                <CardHeader className="gap-3 border-b border-slate-200 pb-6">
                    <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Question review
                    </div>
                    <CardTitle className="font-serif text-3xl font-bold text-slate-950">
                        Review what moved the score.
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    <Accordion type="multiple" className="space-y-4">
                        {result.questionReview.map((question) => (
                            <AccordionItem
                                key={question.id}
                                value={question.id}
                                className="overflow-hidden rounded-[24px] border border-slate-200 px-5"
                            >
                                <AccordionTrigger className="text-left text-base font-semibold text-slate-900 hover:no-underline">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge className="rounded-full border-0 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-700">
                                                Q{question.order}
                                            </Badge>
                                            <Badge className={`rounded-full border-0 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${
                                                question.isCorrect
                                                    ? 'bg-emerald-100 text-emerald-800'
                                                    : 'bg-rose-100 text-rose-800'
                                            }`}>
                                                {question.isCorrect ? 'Correct' : question.selectedOptionId ? 'Incorrect' : 'Unanswered'}
                                            </Badge>
                                        </div>
                                        <div>{question.stem}</div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="space-y-4 pb-5">
                                    <div className="space-y-3">
                                        {question.options.map((option) => {
                                            const isCorrect = option.id === question.correctOptionId
                                            const isSelected = option.id === question.selectedOptionId

                                            return (
                                                <div
                                                    key={option.id}
                                                    className={`rounded-[20px] border px-4 py-3 text-sm leading-7 ${
                                                        isCorrect
                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                                            : isSelected
                                                                ? 'border-rose-200 bg-rose-50 text-rose-900'
                                                                : 'border-slate-200 bg-slate-50 text-slate-700'
                                                    }`}
                                                >
                                                    <span className="mr-2 font-semibold uppercase tracking-[0.22em]">{option.id}</span>
                                                    {option.text}
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {question.explanation ? (
                                        <div className="rounded-[20px] bg-[#f8f4ed] px-4 py-3 text-sm leading-7 text-slate-700">
                                            {question.explanation}
                                        </div>
                                    ) : null}
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    )
}
