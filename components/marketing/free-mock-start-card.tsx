'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, BookOpenCheck, Clock3, KeyRound, Layers3, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type LeadAttemptState =
    | {
        status: 'IN_PROGRESS'
        sessionId: string
        sessionStatus: string
        serverDeadline: string
    }
    | {
        status: 'USED'
        sessionId: string
        sessionStatus: string
        serverDeadline: string
        submittedAt: string | null
        score: number | null
        percentage: number | null
    }
    | null

type FreeMockStartCardProps = {
    test: {
        id: string
        title: string
        description: string | null
        durationMinutes: number
        questionCount: number
        updatedAt: string
    }
    leadAttempt: LeadAttemptState
}

const LEAD_PROFILE_STORAGE_KEY = 'public-free:lead-profile'

type JsonResponse<T> =
    | {
        ok: true
        data: T
    }
    | {
        ok: false
        status: number
        data: Record<string, unknown> | null
    }

async function postJson<T>(url: string, body: unknown): Promise<JsonResponse<T>> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
        return {
            ok: false,
            status: response.status,
            data,
        }
    }

    return {
        ok: true,
        data: data as T,
    }
}

export function FreeMockStartCard({ test, leadAttempt }: FreeMockStartCardProps) {
    const router = useRouter()

    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [phone, setPhone] = useState('')
    const [showForm, setShowForm] = useState(!leadAttempt)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [registeredStudentMessage, setRegisteredStudentMessage] = useState<string | null>(null)

    useEffect(() => {
        const rawValue = window.localStorage.getItem(LEAD_PROFILE_STORAGE_KEY)
        if (!rawValue) {
            return
        }

        try {
            const savedLead = JSON.parse(rawValue) as {
                fullName?: string
                email?: string
                phone?: string
            }

            setFullName(savedLead.fullName ?? '')
            setEmail(savedLead.email ?? '')
            setPhone(savedLead.phone ?? '')
        } catch {
            window.localStorage.removeItem(LEAD_PROFILE_STORAGE_KEY)
        }
    }, [])

    async function startMockAttempt() {
        const startResponse = await postJson<{ sessionId: string }>(
            `/api/public/free-tests/${test.id}/start`,
            {},
        )

        if (!startResponse.ok) {
            const code = startResponse.data?.code

            if (code === 'FREE_ATTEMPT_ALREADY_USED') {
                const sessionId = typeof startResponse.data?.details === 'object' && startResponse.data?.details
                    ? (startResponse.data.details as { sessionId?: string }).sessionId
                    : undefined

                if (sessionId) {
                    router.push(`/free-mocks/results/${sessionId}`)
                    return
                }
            }

            toast.error(
                typeof startResponse.data?.message === 'string'
                    ? startResponse.data.message
                    : 'Could not start the free mock.',
            )
            return
        }

        router.push(`/free-mocks/session/${startResponse.data.sessionId}`)
    }

    async function handleLeadCapture(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setRegisteredStudentMessage(null)

        if (!fullName.trim() || !email.trim() || !phone.trim()) {
            toast.error('Name, email, and phone are required.')
            return
        }

        setIsSubmitting(true)

        try {
            const leadResponse = await postJson<{
                lead: {
                    id: string
                    name: string
                    email: string
                    phone: string
                }
            }>(
                `/api/public/free-tests/${test.id}/lead`,
                {
                    fullName,
                    email,
                    phone,
                },
            )

            if (!leadResponse.ok) {
                if (leadResponse.data?.code === 'REGISTERED_STUDENT_USE_LOGIN') {
                    const message = typeof leadResponse.data?.message === 'string'
                        ? leadResponse.data.message
                        : 'This email belongs to an enrolled student. Use login instead.'
                    setRegisteredStudentMessage(message)
                    return
                }

                toast.error(
                    typeof leadResponse.data?.message === 'string'
                        ? leadResponse.data.message
                        : 'Could not capture your details.',
                )
                return
            }

            window.localStorage.setItem(
                LEAD_PROFILE_STORAGE_KEY,
                JSON.stringify({
                    fullName: fullName.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                }),
            )

            await startMockAttempt()
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="border-0 bg-white">
                <CardHeader className="gap-4 border-b border-slate-200 pb-6">
                    <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                        Free Mock Brief
                    </div>
                    <CardTitle className="font-serif text-4xl font-bold text-slate-950">
                        {test.title}
                    </CardTitle>
                    <p className="max-w-2xl text-base leading-7 text-slate-600">
                        {test.description || 'Start the public attempt, follow the server timer, and review your score immediately after submission.'}
                    </p>
                </CardHeader>

                <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
                    {[
                        {
                            label: 'Duration',
                            value: `${test.durationMinutes} min`,
                            icon: Clock3,
                        },
                        {
                            label: 'Questions',
                            value: `${test.questionCount}`,
                            icon: Layers3,
                        },
                        {
                            label: 'Attempt policy',
                            value: '1 total free try',
                            icon: ShieldCheck,
                        },
                    ].map((item) => (
                        <div key={item.label} className="rounded-[24px] bg-[#f8f4ed] p-5">
                            <item.icon className="mb-4 h-5 w-5 text-emerald-700" />
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                                {item.label}
                            </div>
                            <div className="mt-2 font-serif text-2xl font-bold text-slate-950">
                                {item.value}
                            </div>
                        </div>
                    ))}
                </CardContent>

                <CardFooter className="flex-col items-start gap-4 border-t border-slate-200 pt-6 text-sm leading-7 text-slate-600">
                    <div className="flex items-start gap-3">
                        <BookOpenCheck className="mt-1 h-4 w-4 text-emerald-700" />
                        <span>Free users stay outside the application login flow. This mock is recorded against a lead record only.</span>
                    </div>
                    <div className="flex items-start gap-3">
                        <KeyRound className="mt-1 h-4 w-4 text-emerald-700" />
                        <span>Already enrolled? Use the top-right login button so you stay inside the paid student experience.</span>
                    </div>
                </CardFooter>
            </Card>

            <div className="space-y-6">
                {leadAttempt && !showForm ? (
                    <Card className="border-0 bg-[linear-gradient(180deg,#0f172a_0%,#1f2937_100%)] text-white">
                        <CardHeader className="gap-4 border-b border-white/10 pb-6">
                            <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-300">
                                Returning attempt
                            </div>
                            <CardTitle className="font-serif text-3xl font-bold text-white">
                                {leadAttempt.status === 'IN_PROGRESS'
                                    ? 'Resume your in-progress free mock'
                                    : 'Your free attempt is already used'}
                            </CardTitle>
                            <p className="text-sm leading-7 text-white/78">
                                Use the same saved lead access to continue where you left off or review your completed result.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-6">
                            {leadAttempt.status === 'IN_PROGRESS' ? (
                                <Button
                                    onClick={() => router.push(`/free-mocks/session/${leadAttempt.sessionId}`)}
                                    className="h-12 w-full rounded-2xl bg-white text-slate-950 hover:bg-white/90"
                                >
                                    Resume Free Mock
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            ) : (
                                <Button
                                    onClick={() => router.push(`/free-mocks/results/${leadAttempt.sessionId}`)}
                                    className="h-12 w-full rounded-2xl bg-white text-slate-950 hover:bg-white/90"
                                >
                                    View Result
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            )}
                            <Button
                                onClick={() => setShowForm(true)}
                                variant="ghost"
                                className="h-12 w-full rounded-2xl border border-white/15 bg-transparent text-white hover:bg-white/10"
                            >
                                Use a Different Email
                            </Button>
                        </CardContent>
                    </Card>
                ) : null}

                {showForm ? (
                    <Card className="border-0 bg-white">
                        <form onSubmit={handleLeadCapture}>
                            <CardHeader className="gap-4 border-b border-slate-200 pb-6">
                                <div className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                                    Lead capture
                                </div>
                                <CardTitle className="font-serif text-3xl font-bold text-slate-950">
                                    Start the public attempt
                                </CardTitle>
                                <p className="text-sm leading-7 text-slate-600">
                                    Submit your full name, valid email, and phone before the mock begins. Returning users should use the same email to resume.
                                </p>
                            </CardHeader>

                            <CardContent className="space-y-5 pt-6">
                                <div className="space-y-2">
                                    <Label htmlFor="fullName">Full name</Label>
                                    <Input
                                        id="fullName"
                                        value={fullName}
                                        onChange={(event) => setFullName(event.target.value)}
                                        placeholder="Your full name"
                                        className="h-12 rounded-2xl"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email address</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        placeholder="name@example.com"
                                        className="h-12 rounded-2xl"
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="phone">Phone number</Label>
                                    <Input
                                        id="phone"
                                        value={phone}
                                        onChange={(event) => setPhone(event.target.value)}
                                        placeholder="+91 98765 43210"
                                        className="h-12 rounded-2xl"
                                        required
                                    />
                                </div>

                                {registeredStudentMessage ? (
                                    <div className="rounded-[24px] bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                                        <p className="font-semibold">Registered student detected</p>
                                        <p className="mt-1">{registeredStudentMessage}</p>
                                        <Button asChild className="mt-4 rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
                                            <Link href="/login">Go to Login</Link>
                                        </Button>
                                    </div>
                                ) : null}
                            </CardContent>

                            <CardFooter className="flex-col items-stretch gap-4 border-t border-slate-200 pt-6">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="h-12 rounded-2xl bg-slate-900 text-base font-semibold text-white hover:bg-slate-800"
                                >
                                    {isSubmitting ? 'Starting your free mock...' : 'Capture Details & Start'}
                                </Button>
                                <p className="text-center text-xs leading-6 text-slate-500">
                                    Free users do not enter the OTP login flow. Enrolled students should use{' '}
                                    <Link href="/login" className="font-semibold text-slate-800 underline-offset-4 hover:underline">
                                        Login
                                    </Link>
                                    .
                                </p>
                            </CardFooter>
                        </form>
                    </Card>
                ) : null}
            </div>
        </div>
    )
}
