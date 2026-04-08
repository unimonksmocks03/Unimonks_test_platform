"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, CheckCircle2, XCircle, TrendingUp, Target, ShieldAlert, Loader2, ArrowLeft, AlertTriangle, RefreshCw, Repeat, Play } from "lucide-react";
import Link from "next/link";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { PLATFORM_POLICY } from "@/lib/config/platform-policy";
import { useEvents } from "@/lib/hooks/use-events";

// ── Types ──
interface AnswerEntry {
    questionId: string;
    optionId: string | null;
}

interface QuestionOption {
    id: string;
    text: string;
    isCorrect?: boolean;
}

interface Question {
    id: string;
    order: number;
    stem: string;
    sharedContext?: string | null;
    options: QuestionOption[] | Record<string, string>;
    explanation?: string;
    difficulty?: string;
    topic?: string;
}

interface SessionData {
    id: string;
    attemptNumber: number;
    status: string;
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    answers: AnswerEntry[];
    submittedAt: string | null;
    startedAt: string;
    tabSwitchCount: number;
}

interface AttemptSummary {
    id: string;
    attemptNumber: number;
    status: "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT" | "FORCE_SUBMITTED";
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    startedAt: string;
    submittedAt: string | null;
}

interface FeedbackData {
    strengths: string[];
    weaknesses: string[];
    actionPlan: string[];
    questionExplanations: Record<string, string>;
    overallTag: string;
    generatedAt: string;
}

interface ResultResponse {
    session: SessionData;
    test: { id: string; title: string; durationMinutes: number; questions: Question[] };
    attemptSummary: {
        attemptsUsed: number;
        attemptsRemaining: number;
        canStartAttempt: boolean;
        hasInProgressSession: boolean;
        latestAttempt: AttemptSummary | null;
        bestAttempt: AttemptSummary | null;
        attemptHistory: AttemptSummary[];
    };
    feedback: FeedbackData | null;
}

interface FeedbackStatusResponse {
    sessionId: string;
    sessionStatus: string;
    submittedAt: string | null;
    hasFeedback: boolean;
    feedback: {
        id: string;
        overallTag: string | null;
        generatedAt: string;
    } | null;
}

// ── Helpers ──
function normalizeOptions(opts: unknown): QuestionOption[] {
    if (Array.isArray(opts)) return opts as QuestionOption[];
    if (typeof opts === "object" && opts !== null) {
        const obj = opts as Record<string, string>;
        return ["A", "B", "C", "D"]
            .filter(k => k !== "correct" && obj[k])
            .map(k => ({ id: k, text: obj[k], isCorrect: k === obj.correct }));
    }
    return [];
}

function getCorrectOption(opts: QuestionOption[]): QuestionOption | undefined {
    return opts.find(o => o.isCorrect);
}

function attemptStatusBadgeClass(status: AttemptSummary["status"]) {
    if (status === "IN_PROGRESS") return "bg-indigo-50 text-indigo-700 border-none";
    if (status === "SUBMITTED") return "bg-emerald-50 text-emerald-700 border-none";
    if (status === "FORCE_SUBMITTED") return "bg-amber-50 text-amber-700 border-none";
    return "bg-rose-50 text-rose-700 border-none";
}

function attemptStatusLabel(status: AttemptSummary["status"]) {
    if (status === "IN_PROGRESS") return "In Progress";
    if (status === "FORCE_SUBMITTED") return "Force Submitted";
    if (status === "TIMED_OUT") return "Timed Out";
    return "Submitted";
}

// ── Progressive AI Feedback Loading ──
const LOADING_STEPS = [
    "Scanning your answers...",
    "Identifying strong topics...",
    "Analyzing weak areas...",
    "Crafting personalized tips...",
    "Generating your action plan...",
];

const POLL_INTERVAL = 8000; // 8 seconds
const POLL_TIMEOUT = 60000; // 1 minute

function FeedbackLoadingCard({ sessionId, onFeedbackReady }: { sessionId: string; onFeedbackReady: () => Promise<void> | void }) {
    const [stepIndex, setStepIndex] = useState(0);
    const [timedOut, setTimedOut] = useState(false);
    const [polling, setPolling] = useState(true);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Cycle through progressive messages (only while polling)
    useEffect(() => {
        if (!polling) return;
        const interval = setInterval(() => {
            setStepIndex(prev => (prev + 1) % LOADING_STEPS.length);
        }, 3000);
        return () => clearInterval(interval);
    }, [polling]);

    // Start polling + auto-stop after 1 minute
    const startPolling = useCallback(() => {
        setTimedOut(false);
        setPolling(true);
        setStepIndex(0);

        // Clear any existing timers
        if (pollRef.current) clearInterval(pollRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Poll every 8s
        pollRef.current = setInterval(async () => {
            const res = await apiClient.get<FeedbackStatusResponse>(`/api/student/results/${sessionId}/feedback-status`);
            if (res.ok && res.data.hasFeedback) {
                await onFeedbackReady();
                if (pollRef.current) clearInterval(pollRef.current);
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                setPolling(false);
            }
        }, POLL_INTERVAL);

        // Stop after 1 minute
        timeoutRef.current = setTimeout(() => {
            if (pollRef.current) clearInterval(pollRef.current);
            setPolling(false);
            setTimedOut(true);
        }, POLL_TIMEOUT);
    }, [sessionId, onFeedbackReady]);

    // Auto-start on mount
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional polling start
        startPolling();
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [startPolling]);

    // Timed out state — show retry button
    if (timedOut) {
        return (
            <div className="col-span-3 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-3xl p-10 text-center">
                <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-4" />
                <p className="text-amber-900 font-serif font-bold text-lg">AI feedback is taking longer than expected</p>
                <p className="text-amber-600 text-sm mt-2 font-medium">The analysis might still be processing. You can retry or check back later.</p>
                <Button onClick={startPolling} className="mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl px-8 h-11 shadow-sm">
                    <RefreshCw className="h-4 w-4 mr-2" /> Retry Analysis
                </Button>
            </div>
        );
    }

    return (
        <div className="col-span-3 bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-3xl p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-5 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-400 to-transparent"></div>
            <div className="relative z-10">
                <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mx-auto mb-4" />
                <p className="text-indigo-900 font-serif font-bold text-lg transition-all duration-500">{LOADING_STEPS[stepIndex]}</p>
                <p className="text-indigo-500 text-sm mt-2 font-medium">Personalized feedback will appear here shortly.</p>
                {/* Progress dots */}
                <div className="flex items-center justify-center gap-2 mt-5">
                    {LOADING_STEPS.map((_, i) => (
                        <div
                            key={i}
                            className={`h-2 rounded-full transition-all duration-500 ${i === stepIndex ? "w-6 bg-indigo-500" : i < stepIndex ? "w-2 bg-indigo-300" : "w-2 bg-indigo-200"}`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function ResultsPage() {
    const params = useParams();
    const sessionId = params?.testAttemptId as string;

    const [data, setData] = useState<ResultResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [feedbackLoading, setFeedbackLoading] = useState(false);

    const fetchResults = useCallback(async () => {
        const res = await apiClient.get<ResultResponse>(`/api/student/results/${sessionId}`);
        if (res.ok) {
            setData(res.data);
            setFeedbackLoading(!res.data.feedback);
        }
    }, [sessionId]);

    // Fetch results once on page load.
    useEffect(() => {
        let isMounted = true;

        (async () => {
            await fetchResults();
            if (isMounted) setIsLoading(false);
        })();

        return () => {
            isMounted = false;
        };
    }, [fetchResults]);

    useEvents((event) => {
        const eventSessionId = typeof event.data.sessionId === "string" ? event.data.sessionId : null;
        if (event.type === "feedback:ready" && eventSessionId === sessionId) {
            void fetchResults();
        }
    }, { enabled: feedbackLoading, interval: 5000 });

    // Loading skeleton
    if (isLoading) {
        return (
            <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto pb-16">
                <div className="flex items-center justify-between border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                    <Skeleton className="h-9 w-64" />
                </div>
                <Skeleton className="h-32 rounded-[2rem]" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 rounded-3xl" />)}
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <XCircle className="h-12 w-12 text-rose-400 mb-4" />
                <h2 className="text-xl font-serif font-bold text-slate-900 mb-2">Results Not Found</h2>
                <p className="text-slate-500 mb-6">This test session could not be loaded.</p>
                <Button asChild variant="outline">
                    <Link href="/student/dashboard">Back to Dashboard</Link>
                </Button>
            </div>
        );
    }

    const { session, test, attemptSummary, feedback } = data;
    const questions = test.questions;
    const answers = session.answers || [];
    const pct = session.percentage ?? 0;
    const score = session.score ?? 0;
    const latestAttempt = attemptSummary.latestAttempt;
    const bestAttempt = attemptSummary.bestAttempt;
    const latestInProgressAttempt = attemptSummary.hasInProgressSession && latestAttempt?.status === "IN_PROGRESS"
        ? latestAttempt
        : null;
    const nextActionLabel = latestInProgressAttempt
        ? `Resume Attempt ${latestInProgressAttempt.attemptNumber}`
        : attemptSummary.attemptsRemaining > 0
            ? "Start Reattempt"
            : null;

    // Compute time taken
    const timeTakenLabel = (() => {
        if (!session.submittedAt) return "—";
        return new Date(session.submittedAt).toLocaleString();
    })();

    const overallLabel = pct >= 90 ? "Outstanding" : pct >= 75 ? "Excellent Work" : pct >= 60 ? "Good Effort" : pct >= 40 ? "Needs Improvement" : "Keep Practicing";
    const overallColor = pct >= 75 ? "emerald" : pct >= 50 ? "amber" : "rose";
    const overallBadgeClass = overallColor === "emerald"
        ? "bg-emerald-100 text-emerald-800"
        : overallColor === "amber"
            ? "bg-amber-100 text-amber-800"
            : "bg-rose-100 text-rose-800";

    return (
        <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto pb-16">
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">{test.title} — Results</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Attempt {session.attemptNumber} of {PLATFORM_POLICY.maxPaidTotalAttempts} · Submitted {timeTakenLabel}
                    </p>
                </div>
                <Button asChild variant="outline" className="rounded-xl">
                    <Link href="/student/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
                </Button>
            </div>

            {/* Score Banner */}
            <Card className="bg-white rounded-[2rem] border-0 overflow-hidden shadow-sm">
                <CardContent className="p-8 md:p-10 flex flex-col md:flex-row md:items-center justify-between gap-8 bg-gradient-to-br from-white to-slate-50">
                    <div className="flex items-center gap-8 border-b md:border-b-0 md:border-r border-slate-200 pb-8 md:pb-0 md:pr-12">
                        <span className="text-6xl md:text-7xl font-extrabold text-slate-900 tracking-tighter">
                            {Math.round(pct)}<span className="text-4xl text-slate-400">%</span>
                        </span>
                        <div className="flex flex-col items-start gap-2">
                            <Badge className={`${overallBadgeClass} border-0 px-4 py-1 font-bold tracking-wider uppercase text-xs rounded-lg shadow-sm`}>
                                <CheckCircle2 className="h-4 w-4 mr-1.5 inline-block" />
                                {feedback?.overallTag || overallLabel}
                            </Badge>
                            <span className="text-sm font-semibold text-slate-500">Overall Accuracy</span>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-row items-center justify-around gap-6 md:justify-end md:gap-16">
                        <div className="flex flex-col gap-1 items-center md:items-start">
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Score</span>
                            <span className="text-2xl font-serif font-bold text-slate-900">
                                {score} <span className="text-lg text-slate-400 font-sans font-medium">/ {session.totalMarks}</span>
                            </span>
                        </div>
                        <div className="w-px h-12 bg-slate-200 hidden md:block"></div>
                        <div className="flex flex-col gap-1 items-center md:items-start">
                            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Tab Switches</span>
                            <span className={`text-2xl font-serif font-bold ${session.tabSwitchCount > 0 ? "text-rose-600" : "text-slate-900"}`}>
                                {session.tabSwitchCount}
                            </span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white rounded-3xl border-0 overflow-hidden shadow-sm">
                <CardContent className="p-6 md:p-8">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current Attempt</div>
                            <div className="mt-2 text-2xl font-serif font-bold text-slate-900">
                                Attempt {session.attemptNumber} of {PLATFORM_POLICY.maxPaidTotalAttempts}
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                                {attemptSummary.attemptsRemaining} remaining after this attempt.
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Latest Attempt</div>
                            <div className="mt-2 text-2xl font-serif font-bold text-slate-900">
                                {latestAttempt
                                    ? latestAttempt.status === "IN_PROGRESS"
                                        ? `Attempt ${latestAttempt.attemptNumber}`
                                        : `${Math.round(latestAttempt.percentage ?? 0)}%`
                                    : "—"}
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                                {latestAttempt
                                    ? latestAttempt.status === "IN_PROGRESS"
                                        ? "Currently in progress"
                                        : `Attempt ${latestAttempt.attemptNumber}`
                                    : "No attempts recorded"}
                            </p>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Best Attempt</div>
                            <div className="mt-2 text-2xl font-serif font-bold text-slate-900">
                                {bestAttempt ? `${Math.round(bestAttempt.percentage ?? 0)}%` : "—"}
                            </div>
                            <p className="mt-2 text-sm text-slate-500">
                                {bestAttempt ? `Attempt ${bestAttempt.attemptNumber}` : "No completed attempts yet"}
                            </p>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <Badge className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${attemptStatusBadgeClass(session.status as AttemptSummary["status"])}`}>
                            {attemptStatusLabel(session.status as AttemptSummary["status"])}
                        </Badge>
                        {nextActionLabel ? (
                            <Button asChild className="rounded-xl bg-slate-900 text-white hover:bg-black">
                                <Link href={`/arena/${test.id}`}>
                                    {latestInProgressAttempt ? <Repeat className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                                    {nextActionLabel}
                                </Link>
                            </Button>
                        ) : (
                            <Badge className="rounded-full bg-rose-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700 border-none">
                                Attempt limit reached
                            </Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-white rounded-3xl border-0 overflow-hidden shadow-sm">
                <CardHeader className="border-b bg-surface p-6" style={{ borderColor: "var(--border-soft)" }}>
                    <CardTitle className="font-serif text-xl text-slate-900">Attempt History</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                    <div className="flex flex-col gap-3">
                        {attemptSummary.attemptHistory.map((attempt) => {
                            const isCurrentAttempt = attempt.id === session.id;
                            const href = attempt.status === "IN_PROGRESS" ? `/arena/${test.id}` : `/student/results/${attempt.id}`;

                            return (
                                <div
                                    key={attempt.id}
                                    className={`flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between ${
                                        isCurrentAttempt
                                            ? "border-indigo-200 bg-indigo-50/70"
                                            : "border-slate-200 bg-slate-50/70"
                                    }`}
                                >
                                    <div className="flex flex-col gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-slate-900">Attempt {attempt.attemptNumber}</span>
                                            <Badge className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${attemptStatusBadgeClass(attempt.status)}`}>
                                                {attemptStatusLabel(attempt.status)}
                                            </Badge>
                                            {isCurrentAttempt && (
                                                <Badge className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 border-none">
                                                    Current
                                                </Badge>
                                            )}
                                            {bestAttempt?.id === attempt.id && (
                                                <Badge className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 border-none">
                                                    Best
                                                </Badge>
                                            )}
                                        </div>
                                        <span className="text-sm text-slate-500">
                                            {attempt.submittedAt
                                                ? `Submitted ${new Date(attempt.submittedAt).toLocaleString()}`
                                                : `Started ${new Date(attempt.startedAt).toLocaleString()}`}
                                        </span>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                                        {attempt.status !== "IN_PROGRESS" && (
                                            <span className="font-semibold text-slate-900">
                                                {Math.round(attempt.percentage ?? 0)}%
                                            </span>
                                        )}
                                        {attempt.status !== "IN_PROGRESS" && (
                                            <span>{attempt.score ?? 0}/{attempt.totalMarks}</span>
                                        )}
                                        <Link href={href} className="font-semibold text-indigo-600 hover:text-indigo-800">
                                            {attempt.status === "IN_PROGRESS" ? "Resume" : isCurrentAttempt ? "Viewing" : "Open"}
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* AI Insights */}
            <h2 className="text-2xl font-serif font-bold text-slate-900 tracking-tight mt-4">Performance Insights</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {feedbackLoading || !feedback ? (
                    <FeedbackLoadingCard sessionId={sessionId} onFeedbackReady={fetchResults} />
                ) : (
                    <>
                        <Card className="bg-emerald-50 rounded-3xl border shadow-sm border-emerald-100 flex flex-col h-full">
                            <CardHeader className="pb-2 flex flex-row items-start gap-4">
                                <div className="bg-white p-3 rounded-2xl shadow-sm text-emerald-600 shrink-0 mt-1">
                                    <TrendingUp className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <CardTitle className="text-emerald-900 font-bold font-serif text-lg">Strengths</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <ul className="text-emerald-800/90 text-sm leading-relaxed font-medium space-y-2">
                                    {(feedback.strengths as string[]).map((s, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                                            <span>{s}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>

                        <Card className="bg-rose-50 rounded-3xl border shadow-sm border-rose-100 flex flex-col h-full">
                            <CardHeader className="pb-2 flex flex-row items-start gap-4">
                                <div className="bg-white p-3 rounded-2xl shadow-sm text-rose-600 shrink-0 mt-1">
                                    <ShieldAlert className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <CardTitle className="text-rose-900 font-bold font-serif text-lg">Improvements</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <ul className="text-rose-800/90 text-sm leading-relaxed font-medium space-y-2">
                                    {(feedback.weaknesses as string[]).map((w, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-500" />
                                            <span>{w}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>

                        <Card className="bg-indigo-50 rounded-3xl border shadow-sm border-indigo-100 flex flex-col h-full">
                            <CardHeader className="pb-2 flex flex-row items-start gap-4">
                                <div className="bg-white p-3 rounded-2xl shadow-sm text-indigo-600 shrink-0 mt-1">
                                    <Target className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <CardTitle className="text-indigo-900 font-bold font-serif text-lg">Action Plan</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-2">
                                <ul className="text-indigo-800/90 text-sm leading-relaxed font-medium space-y-2">
                                    {(feedback.actionPlan as string[]).map((a, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            <Target className="h-4 w-4 mt-0.5 shrink-0 text-indigo-500" />
                                            <span>{a}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>

            {/* Question Breakdown */}
            <div className="flex flex-col mt-6 gap-6">
                <h2 className="text-2xl font-serif font-bold text-slate-900 tracking-tight border-b pb-4" style={{ borderColor: "var(--border-soft)" }}>Question Breakdown</h2>

                <Accordion type="multiple" className="w-full space-y-4">
                    {questions.map((question, index) => {
                        const opts = normalizeOptions(question.options);
                        const correct = getCorrectOption(opts);
                        const answer = answers.find(a => a.questionId === question.id);
                        const selectedOpt = opts.find(o => o.id === answer?.optionId);
                        const isCorrect = selectedOpt?.id === correct?.id;
                        const wasAnswered = !!answer?.optionId;
                        const aiExplanation = feedback?.questionExplanations?.[String(index)] || feedback?.questionExplanations?.[question.id];

                        return (
                            <AccordionItem value={`item-${index}`} key={question.id} className="border-0 bg-white rounded-3xl shadow-sm overflow-hidden" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                                <AccordionTrigger className="px-6 py-6 hover:no-underline hover:bg-slate-50 transition-colors [&[data-state=open]]:bg-slate-50">
                                    <div className="flex items-center gap-6 text-left w-full justify-between pr-4">
                                        <div className="flex items-center gap-4">
                                            {!wasAnswered ? (
                                                <div className="bg-slate-100 text-slate-400 p-2 rounded-xl shrink-0">
                                                    <XCircle className="h-6 w-6" />
                                                </div>
                                            ) : isCorrect ? (
                                                <div className="bg-emerald-100 text-emerald-600 p-2 rounded-xl shrink-0"><CheckCircle2 className="h-6 w-6" /></div>
                                            ) : (
                                                <div className="bg-rose-100 text-rose-600 p-2 rounded-xl shrink-0"><XCircle className="h-6 w-6" /></div>
                                            )}
                                            <div className="font-serif font-semibold text-lg text-slate-900">Q{index + 1}. {question.stem}</div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {question.difficulty && (
                                                <Badge variant="outline" className={`text-[10px] uppercase ${question.difficulty === 'HARD' ? 'border-rose-300 text-rose-600' : question.difficulty === 'EASY' ? 'border-emerald-300 text-emerald-600' : 'border-amber-300 text-amber-600'}`}>
                                                    {question.difficulty}
                                                </Badge>
                                            )}
                                            {question.topic && (
                                                <Badge variant="secondary" className="text-[10px]">{question.topic}</Badge>
                                            )}
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="px-6 pb-6 pt-0 bg-slate-50 border-t border-slate-100">
                                    {question.sharedContext ? (
                                        <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-3">
                                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-indigo-700">
                                                Shared Reference
                                            </div>
                                            <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                                {question.sharedContext}
                                            </div>
                                        </div>
                                    ) : null}
                                    <div className="pt-6 flex flex-col lg:flex-row gap-8 lg:gap-12">
                                        <div className="flex-1 flex flex-col gap-4">
                                            <div className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-1">Your response:</div>
                                            {wasAnswered ? (
                                                <div className={`p-4 rounded-xl border flex items-center justify-between ${isCorrect ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                                                    <span className="font-semibold text-base">{selectedOpt?.id}. {selectedOpt?.text}</span>
                                                    {isCorrect ? <CheckCircle2 className="h-5 w-5 opacity-70" /> : <XCircle className="h-5 w-5 opacity-70" />}
                                                </div>
                                            ) : (
                                                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
                                                    <span className="font-semibold text-base">Not Answered</span>
                                                </div>
                                            )}

                                            {!isCorrect && correct && (
                                                <>
                                                    <div className="font-bold text-xs uppercase tracking-wider text-slate-400 mt-2">Correct Answer:</div>
                                                    <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 flex items-center justify-between">
                                                        <span className="font-semibold text-base">{correct.id}. {correct.text}</span>
                                                        <CheckCircle2 className="h-5 w-5 opacity-70" />
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {(aiExplanation || question.explanation) && (
                                            <div className="lg:w-[45%] bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col">
                                                <h5 className="font-bold font-serif text-slate-800 mb-2 flex items-center gap-2">
                                                    <Lightbulb className="h-5 w-5 text-amber-500" /> {aiExplanation ? "AI Explanation" : "Explanation"}
                                                </h5>
                                                <p className="text-sm text-slate-600 leading-relaxed font-medium">
                                                    {aiExplanation || question.explanation}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        );
                    })}
                </Accordion>
            </div>
        </div>
    );
}
