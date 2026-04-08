'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Clock3, RefreshCcw, SendHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { apiClient } from '@/lib/api-client'

type Question = {
    id: string
    order: number
    stem: string
    sharedContext: string | null
    options: Array<{
        id: string
        text: string
    }>
    difficulty: string
    topic: string | null
}

type AnswerEntry = {
    questionId: string
    optionId: string | null
    markedForReview?: boolean
    answeredAt: string
}

type SessionPayload = {
    sessionId: string
    testId: string
    testTitle: string
    questions: Question[]
    answers: AnswerEntry[]
    serverDeadline: string
    durationMinutes: number
    resumed: boolean
}

const STORAGE_PREFIX = 'public-free:answers:'

function formatTime(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function FreeTestSessionClient({ sessionId }: { sessionId: string }) {
    const router = useRouter()

    const [isLoading, setIsLoading] = useState(true)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [testTitle, setTestTitle] = useState('')
    const [questions, setQuestions] = useState<Question[]>([])
    const [answers, setAnswers] = useState<AnswerEntry[]>([])
    const [currentIndex, setCurrentIndex] = useState(0)
    const [timeLeft, setTimeLeft] = useState(0)

    const deadlineRef = useRef(0)
    const dirtyRef = useRef(false)
    const answersRef = useRef<AnswerEntry[]>([])
    const syncPromiseRef = useRef<Promise<boolean> | null>(null)

    function storageKey() {
        return `${STORAGE_PREFIX}${sessionId}`
    }

    function persistAnswers(nextAnswers: AnswerEntry[]) {
        answersRef.current = nextAnswers
        setAnswers(nextAnswers)
        window.localStorage.setItem(storageKey(), JSON.stringify(nextAnswers))
        dirtyRef.current = true
    }

    async function syncAnswers(force = false) {
        if (syncPromiseRef.current) {
            return syncPromiseRef.current
        }

        if (!dirtyRef.current && !force) {
            return true
        }

        const latestAnswers = answersRef.current
        const syncPromise = (async () => {
            const response = await apiClient.post<{ saved: boolean }>(
                `/api/public/free-sessions/${sessionId}/batch-answer`,
                {
                    answers: latestAnswers,
                },
            )

            if (!response.ok) {
                dirtyRef.current = true

                if (response.code === 'DEADLINE_PASSED' || response.code === 'SESSION_ENDED') {
                    router.replace(`/free-mocks/results/${sessionId}`)
                }

                return false
            }

            dirtyRef.current = false
            return true
        })()

        syncPromiseRef.current = syncPromise

        try {
            return await syncPromise
        } finally {
            syncPromiseRef.current = null
        }
    }

    async function handleSubmit(force = false) {
        if (isSubmitting) {
            return
        }

        if (!force) {
            const unanswered = questions.length - answersRef.current.filter((answer) => answer.optionId).length
            if (unanswered > 0) {
                const confirmed = window.confirm(
                    `You still have ${unanswered} unanswered question(s). Submit anyway?`,
                )

                if (!confirmed) {
                    return
                }
            }
        }

        setIsSubmitting(true)

        try {
            const synced = await syncAnswers(true)
            if (!synced && !force) {
                toast.error('Could not sync your latest answers.')
                return
            }

            const response = await apiClient.post<{
                score: number
                totalMarks: number
                percentage: number
            }>(`/api/public/free-sessions/${sessionId}/submit`, {
                answers: answersRef.current,
            })

            if (!response.ok) {
                if (response.code === 'DEADLINE_PASSED' || response.code === 'SESSION_ENDED' || response.code === 'TIMED_OUT') {
                    router.replace(`/free-mocks/results/${sessionId}`)
                    return
                }

                toast.error(response.message || 'Could not submit the free mock.')
                return
            }

            window.localStorage.removeItem(storageKey())
            toast.success(`Submitted: ${response.data.score}/${response.data.totalMarks} (${response.data.percentage}%)`)
            router.replace(`/free-mocks/results/${sessionId}`)
        } finally {
            setIsSubmitting(false)
        }
    }

    useEffect(() => {
        let active = true

        ;(async () => {
            const response = await apiClient.get<SessionPayload>(`/api/public/free-sessions/${sessionId}`)

            if (!active) {
                return
            }

            if (!response.ok) {
                if (response.code === 'SESSION_ENDED' || response.code === 'TIMED_OUT') {
                    router.replace(`/free-mocks/results/${sessionId}`)
                    return
                }

                setErrorMessage(
                    response.code === 'LEAD_ACCESS_REQUIRED'
                        ? 'This browser no longer has access to the free mock. Return to the catalog and re-enter the same lead details.'
                        : response.message,
                )
                setIsLoading(false)
                return
            }

            const localRaw = window.localStorage.getItem(storageKey())
            let localAnswers: AnswerEntry[] | null = null

            if (localRaw) {
                try {
                    localAnswers = JSON.parse(localRaw) as AnswerEntry[]
                } catch {
                    window.localStorage.removeItem(storageKey())
                }
            }
            const serverAnswers = response.data.answers ?? []
            const hydratedAnswers = localAnswers && localAnswers.length >= serverAnswers.length
                ? localAnswers
                : serverAnswers

            setTestTitle(response.data.testTitle)
            setQuestions(response.data.questions)
            setAnswers(hydratedAnswers)
            answersRef.current = hydratedAnswers
            deadlineRef.current = new Date(response.data.serverDeadline).getTime()
            setTimeLeft(Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000)))
            setIsLoading(false)

            if (localAnswers && localAnswers.length >= serverAnswers.length) {
                dirtyRef.current = true
            } else if (serverAnswers.length > 0) {
                window.localStorage.setItem(storageKey(), JSON.stringify(serverAnswers))
            }

            if (response.data.resumed) {
                toast.info('Resumed your saved free mock.')
            }
        })()

        return () => {
            active = false
        }
    }, [router, sessionId])

    useEffect(() => {
        if (isLoading) {
            return
        }

        const countdown = window.setInterval(() => {
            const remaining = Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000))
            setTimeLeft(remaining)

            if (remaining <= 0) {
                window.clearInterval(countdown)
                void handleSubmit(true)
            }
        }, 1000)

        const batchSync = window.setInterval(() => {
            void syncAnswers()
        }, 15000)

        const statusSync = window.setInterval(async () => {
            const response = await apiClient.get<{ timeRemaining: number; status: string }>(
                `/api/public/free-sessions/${sessionId}/status`,
            )

            if (!response.ok) {
                return
            }

            if (response.data.status !== 'IN_PROGRESS') {
                router.replace(`/free-mocks/results/${sessionId}`)
                return
            }

            deadlineRef.current = Date.now() + (response.data.timeRemaining * 1000)
        }, 60000)

        return () => {
            window.clearInterval(countdown)
            window.clearInterval(batchSync)
            window.clearInterval(statusSync)
        }
    }, [isLoading, router, sessionId])

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

    if (errorMessage) {
        return (
            <Card className="border-0 bg-white">
                <CardContent className="space-y-5 p-8">
                    <h2 className="font-serif text-3xl font-bold text-slate-950">Free mock access unavailable</h2>
                    <p className="max-w-2xl text-base leading-7 text-slate-600">{errorMessage}</p>
                    <Button asChild className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
                        <Link href="/free-mocks">Return to Free Mock Catalog</Link>
                    </Button>
                </CardContent>
            </Card>
        )
    }

    const currentQuestion = questions[currentIndex]

    if (!currentQuestion) {
        return null
    }

    const currentAnswer = answers.find((answer) => answer.questionId === currentQuestion.id)
    const selectedOption = currentAnswer?.optionId ?? ''
    const answeredCount = answers.filter((answer) => answer.optionId !== null).length
    const markedCount = answers.filter((answer) => answer.markedForReview).length
    const completion = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0

    function updateQuestionAnswer(optionId: string | null, markedForReview?: boolean) {
        const currentAnswers = [...answersRef.current]
        const existingIndex = currentAnswers.findIndex((answer) => answer.questionId === currentQuestion.id)
        const nextAnswer: AnswerEntry = {
            questionId: currentQuestion.id,
            optionId,
            markedForReview,
            answeredAt: new Date().toISOString(),
        }

        if (existingIndex === -1) {
            currentAnswers.push(nextAnswer)
        } else if (optionId === null && !markedForReview) {
            currentAnswers.splice(existingIndex, 1)
        } else {
            currentAnswers[existingIndex] = {
                ...currentAnswers[existingIndex],
                ...nextAnswer,
            }
        }

        persistAnswers(currentAnswers)
    }

    function questionState(question: Question) {
        if (question.id === currentQuestion.id) {
            return 'current'
        }

        const answer = answers.find((entry) => entry.questionId === question.id)
        if (answer?.markedForReview) {
            return 'marked'
        }

        if (answer?.optionId) {
            return 'answered'
        }

        return 'idle'
    }

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
                <Card className="border-0 bg-white">
                    <CardContent className="space-y-5 p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-2">
                                <Badge className="w-fit rounded-full border-0 bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-800">
                                    Free Mock Session
                                </Badge>
                                <h1 className="font-serif text-3xl font-bold text-slate-950">{testTitle}</h1>
                            </div>
                            <div className={`inline-flex items-center gap-3 rounded-[24px] px-5 py-3 font-semibold ${
                                timeLeft <= 300 ? 'bg-rose-50 text-rose-700' : 'bg-slate-900 text-white'
                            }`}>
                                <Clock3 className="h-5 w-5" />
                                <span>{formatTime(timeLeft)}</span>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm font-medium text-slate-500">
                                <span>{answeredCount} answered</span>
                                <span>{markedCount} marked for review</span>
                            </div>
                            <Progress value={completion} className="h-3 bg-slate-200" indicatorClassName="bg-emerald-600" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 bg-white">
                    <CardHeader className="gap-4 border-b border-slate-200 pb-6">
                        <div className="flex items-center justify-between gap-4">
                            <Badge className="rounded-full border-0 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
                                Question {currentIndex + 1} of {questions.length}
                            </Badge>
                            {currentQuestion.topic ? (
                                <span className="text-sm font-medium text-slate-500">{currentQuestion.topic}</span>
                            ) : null}
                        </div>
                        <CardTitle className="text-2xl font-semibold leading-9 text-slate-950">
                            {currentQuestion.stem}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                        {currentQuestion.sharedContext ? (
                            <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/60 px-5 py-4">
                                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                                    Shared Reference
                                </div>
                                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                    {currentQuestion.sharedContext}
                                </div>
                            </div>
                        ) : null}
                        <RadioGroup
                            value={selectedOption}
                            onValueChange={(value) => updateQuestionAnswer(value)}
                            className="space-y-3"
                        >
                            {currentQuestion.options.map((option) => (
                                <Label
                                    key={option.id}
                                    htmlFor={`${currentQuestion.id}-${option.id}`}
                                    className={`flex cursor-pointer items-start gap-4 rounded-[24px] border p-4 transition-colors ${
                                        selectedOption === option.id
                                            ? 'border-emerald-600 bg-emerald-50'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                >
                                    <RadioGroupItem
                                        id={`${currentQuestion.id}-${option.id}`}
                                        value={option.id}
                                        className="mt-1"
                                    />
                                    <div className="space-y-1">
                                        <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                                            Option {option.id}
                                        </div>
                                        <div className="text-base leading-7 text-slate-800">{option.text}</div>
                                    </div>
                                </Label>
                            ))}
                        </RadioGroup>

                        <div className="flex flex-wrap gap-3">
                            <Button
                                type="button"
                                onClick={() => updateQuestionAnswer(null)}
                                variant="ghost"
                                className="rounded-2xl bg-slate-100 px-5 hover:bg-slate-200"
                            >
                                Clear
                            </Button>
                            <Button
                                type="button"
                                onClick={() => updateQuestionAnswer(selectedOption || null, !currentAnswer?.markedForReview)}
                                variant="ghost"
                                className="rounded-2xl bg-amber-50 px-5 text-amber-800 hover:bg-amber-100"
                            >
                                {currentAnswer?.markedForReview ? 'Unmark Review' : 'Mark for Review'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                        disabled={currentIndex === 0}
                        className="rounded-2xl bg-white px-5 hover:bg-slate-100"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Previous
                    </Button>
                    <div className="flex flex-wrap gap-3">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void syncAnswers(true)}
                            className="rounded-2xl bg-white px-5 hover:bg-slate-100"
                        >
                            <RefreshCcw className="h-4 w-4" />
                            Save Progress
                        </Button>
                        {currentIndex < questions.length - 1 ? (
                            <Button
                                type="button"
                                onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
                                className="rounded-2xl bg-slate-900 px-5 text-white hover:bg-slate-800"
                            >
                                Next
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                onClick={() => void handleSubmit(false)}
                                disabled={isSubmitting}
                                className="rounded-2xl bg-emerald-600 px-5 text-white hover:bg-emerald-500"
                            >
                                <SendHorizontal className="h-4 w-4" />
                                {isSubmitting ? 'Submitting...' : 'Submit Free Mock'}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <Card className="h-fit border-0 bg-white xl:sticky xl:top-28">
                <CardHeader className="gap-3 border-b border-slate-200 pb-6">
                    <div className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
                        Question Navigator
                    </div>
                    <CardTitle className="font-serif text-2xl font-bold text-slate-950">
                        Keep the one free attempt clean.
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                    <div className="grid grid-cols-5 gap-3">
                        {questions.map((question, index) => {
                            const state = questionState(question)

                            return (
                                <button
                                    key={question.id}
                                    type="button"
                                    onClick={() => setCurrentIndex(index)}
                                    className={`flex h-11 items-center justify-center rounded-2xl text-sm font-semibold transition-colors ${
                                        state === 'current'
                                            ? 'bg-slate-900 text-white'
                                            : state === 'answered'
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : state === 'marked'
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                >
                                    {index + 1}
                                </button>
                            )
                        })}
                    </div>

                    <div className="space-y-3 text-sm leading-6 text-slate-600">
                        <div className="flex items-center justify-between">
                            <span>Answered</span>
                            <span className="font-semibold text-slate-900">{answeredCount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Marked</span>
                            <span className="font-semibold text-slate-900">{markedCount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Remaining</span>
                            <span className="font-semibold text-slate-900">{questions.length - answeredCount}</span>
                        </div>
                    </div>

                    <div className="rounded-[24px] bg-[#f8f4ed] p-4 text-sm leading-7 text-slate-600">
                        One public attempt only. Make sure your latest answers are saved before time runs out.
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
