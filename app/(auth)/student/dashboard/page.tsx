"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search, Sparkles, Trophy } from "lucide-react";

import { PLATFORM_POLICY } from "@/lib/config/platform-policy";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ALL_TESTS_BATCH_FILTER,
    buildStudentBatchCards,
    filterStudentTests,
} from "@/lib/utils/student-dashboard";

type AttemptSummary = {
    id: string;
    attemptNumber: number;
    status: "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT" | "FORCE_SUBMITTED";
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    startedAt: string;
    submittedAt: string | null;
};

type AssignedTest = {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    questionCount: number;
    assignedBatches: BatchInfo[];
    attemptsUsed: number;
    attemptsRemaining: number;
    canStartAttempt: boolean;
    hasInProgressSession: boolean;
    latestAttempt: AttemptSummary | null;
    bestAttempt: AttemptSummary | null;
    attemptHistory: AttemptSummary[];
};

type RecentAttempt = {
    sessionId: string;
    testId: string;
    testTitle: string;
    attemptNumber: number;
    status: "SUBMITTED" | "TIMED_OUT" | "FORCE_SUBMITTED";
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    submittedAt: string | null;
    hasFeedback: boolean;
    overallTag: string | null;
};

type BatchInfo = {
    id: string;
    name: string;
    code: string;
};

type DashboardData = {
    tests: AssignedTest[];
    recentAttempts: RecentAttempt[];
    stats: {
        completedAttempts: number;
        avgScore: number;
        bestScore: number;
        activeAssignments: number;
    };
    batches: BatchInfo[];
};

const MAX_ATTEMPTS = PLATFORM_POLICY.maxPaidTotalAttempts;

function DashboardSkeleton() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto pb-10">
            <div className="border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <Skeleton className="h-9 w-64 mb-2" />
                <Skeleton className="h-4 w-80" />
            </div>
            <Skeleton className="h-56 rounded-[2rem]" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((index) => (
                    <Skeleton key={index} className="h-28 rounded-3xl" />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] gap-8">
                <Skeleton className="h-[560px] rounded-3xl" />
                <Skeleton className="h-[560px] rounded-3xl" />
            </div>
        </div>
    );
}

function statusBadgeClass(status: AttemptSummary["status"] | RecentAttempt["status"]) {
    if (status === "IN_PROGRESS") return "bg-indigo-50 text-indigo-700 border-none";
    if (status === "SUBMITTED") return "bg-emerald-50 text-emerald-700 border-none";
    if (status === "FORCE_SUBMITTED") return "bg-amber-50 text-amber-700 border-none";
    return "bg-rose-50 text-rose-700 border-none";
}

function statusLabel(status: AttemptSummary["status"] | RecentAttempt["status"]) {
    if (status === "IN_PROGRESS") return "In Progress";
    if (status === "FORCE_SUBMITTED") return "Force Submitted";
    if (status === "TIMED_OUT") return "Timed Out";
    return "Submitted";
}

function getAttemptDisplayNumber(test: AssignedTest) {
    if (test.hasInProgressSession && test.latestAttempt) {
        return test.latestAttempt.attemptNumber;
    }

    if (test.attemptsRemaining > 0) {
        return Math.min(test.attemptsUsed + 1, MAX_ATTEMPTS);
    }

    return MAX_ATTEMPTS;
}

function getPrimaryAction(test: AssignedTest) {
    if (!test.canStartAttempt) {
        return null;
    }

    if (test.hasInProgressSession) {
        return { label: "Resume", href: `/arena/${test.id}` };
    }

    if (test.attemptsUsed > 0) {
        return { label: "Reattempt", href: `/arena/${test.id}` };
    }

    return { label: "Start Attempt", href: `/arena/${test.id}` };
}

export default function StudentDashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBatchId, setSelectedBatchId] = useState(ALL_TESTS_BATCH_FILTER);

    useEffect(() => {
        (async () => {
            const response = await apiClient.get<DashboardData>("/api/student/dashboard");

            if (response.ok) {
                setData(response.data);
            }

            setIsLoading(false);
        })();
    }, []);

    if (isLoading || !data) {
        return <DashboardSkeleton />;
    }

    const batchCards = buildStudentBatchCards(data.tests, data.batches);
    const visibleTests = filterStudentTests(data.tests, searchQuery, selectedBatchId);
    const featuredTest = visibleTests.find((test) => test.hasInProgressSession)
        ?? visibleTests.find((test) => test.canStartAttempt)
        ?? visibleTests[0]
        ?? data.tests.find((test) => test.hasInProgressSession)
        ?? data.tests.find((test) => test.canStartAttempt)
        ?? data.tests[0];
    const featuredAction = featuredTest ? getPrimaryAction(featuredTest) : null;
    const selectedBatchLabel = useMemo(
        () => batchCards.find((batch) => batch.id === selectedBatchId)?.name ?? "All Tests",
        [batchCards, selectedBatchId],
    );

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto pb-10">
            <div className="flex items-center justify-between border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Student Dashboard</h1>
                    <p className="text-slate-500 mt-1">Track every paid attempt, resume in-progress mocks, and jump straight into tests by batch or by name.</p>
                </div>
            </div>

            <Card className="rounded-3xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                <CardHeader className="border-b bg-surface p-6" style={{ borderColor: "var(--border-soft)" }}>
                    <CardTitle className="font-serif text-xl text-slate-800">Find Tests Faster</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-5 p-6">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search your tests by name..."
                            className="h-12 rounded-2xl border-transparent bg-surface-2 pl-11 text-sm font-medium"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {batchCards.map((batch) => {
                            const isActive = batch.id === selectedBatchId;

                            return (
                                <button
                                    key={batch.id}
                                    type="button"
                                    onClick={() => setSelectedBatchId(batch.id)}
                                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                                        isActive
                                            ? "border-indigo-200 bg-indigo-50 shadow-sm"
                                            : "border-slate-200 bg-slate-50/80 hover:border-indigo-100 hover:bg-white"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-semibold text-slate-900">{batch.name}</div>
                                            <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{batch.code}</div>
                                        </div>
                                        <span className={`inline-flex min-w-[2rem] items-center justify-center rounded-full px-2 py-1 text-xs font-bold ${
                                            isActive ? "bg-indigo-600 text-white" : "bg-white text-slate-700"
                                        }`}>
                                            {batch.count}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            {featuredTest ? (
                <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-500 via-indigo-600 to-indigo-800 p-8 md:p-10" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                    <div className="relative z-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
                        <div className="max-w-3xl space-y-4">
                            <Badge className="bg-white/20 hover:bg-white/20 text-white border-0 font-bold uppercase tracking-wider text-[10px] px-3 py-1">
                                {featuredTest.hasInProgressSession ? "Resume Available" : featuredTest.canStartAttempt ? "Next Paid Mock" : "Attempt Summary"}
                            </Badge>
                            <div>
                                <h2 className="text-2xl md:text-3xl font-serif font-bold text-white leading-tight">{featuredTest.title}</h2>
                                {featuredTest.description && (
                                    <p className="mt-2 text-sm text-indigo-100/90 leading-relaxed">{featuredTest.description}</p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-3 text-sm font-medium text-indigo-100">
                                <span>{featuredTest.questionCount} questions</span>
                                <span>{featuredTest.durationMinutes} min</span>
                                <span>Attempt {getAttemptDisplayNumber(featuredTest)} of {MAX_ATTEMPTS}</span>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                <Badge className="border-0 bg-white/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                                    {featuredTest.attemptsRemaining} remaining
                                </Badge>
                                {featuredTest.latestAttempt && (
                                    <Badge className="border-0 bg-white/15 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                                        Latest: {featuredTest.latestAttempt.status === "IN_PROGRESS"
                                            ? `Attempt ${featuredTest.latestAttempt.attemptNumber} in progress`
                                            : `${Math.round(featuredTest.latestAttempt.percentage ?? 0)}%`}
                                    </Badge>
                                )}
                                {featuredTest.bestAttempt && (
                                    <Badge className="border-0 bg-emerald-400/20 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">
                                        Best: {Math.round(featuredTest.bestAttempt.percentage ?? 0)}%
                                    </Badge>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col items-start gap-4 md:items-end">
                            {featuredAction ? (
                                <Button asChild className="rounded-2xl bg-emerald-400 px-8 py-6 text-base font-bold text-slate-950 shadow-clay-inner hover:bg-emerald-300">
                                    <Link href={featuredAction.href}>
                                        {featuredAction.label} <ArrowRight className="ml-2 h-5 w-5" />
                                    </Link>
                                </Button>
                            ) : (
                                <Button disabled className="rounded-2xl bg-white/20 px-8 py-6 text-base font-bold text-white">
                                    Attempt limit reached
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 -mb-24 -ml-24 w-64 h-64 bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />
                </div>
            ) : (
                <div className="rounded-[2rem] bg-surface-2 p-8 text-center text-slate-500 font-medium" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                    No assigned paid mock tests right now.
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
                {[
                    { label: "Assigned Tests", value: data.tests.length },
                    { label: "Completed Attempts", value: data.stats.completedAttempts },
                    { label: "Average Score", value: `${data.stats.avgScore}%` },
                    { label: "Best Score", value: `${data.stats.bestScore}%` },
                ].map((metric) => (
                    <Card key={metric.label} className="rounded-2xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                        <CardContent className="p-5 text-center">
                            <div className="text-2xl font-serif font-bold text-slate-900">{metric.value}</div>
                            <div className="mt-1 text-xs font-medium text-slate-500">{metric.label}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start">
                <Card className="rounded-3xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                    <CardHeader className="border-b bg-surface p-8" style={{ borderColor: "var(--border-soft)" }}>
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                            <CardTitle className="font-serif text-xl text-slate-800">Assigned Mock Tests</CardTitle>
                            <div className="text-sm font-medium text-slate-500">
                                Showing <span className="font-semibold text-slate-900">{visibleTests.length}</span> test{visibleTests.length === 1 ? "" : "s"}
                                {selectedBatchId !== ALL_TESTS_BATCH_FILTER ? ` in ${selectedBatchLabel}` : ""}
                                {searchQuery.trim() ? ` matching “${searchQuery.trim()}”` : ""}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-6 p-8">
                        {visibleTests.length === 0 ? (
                            <div className="py-10 text-center text-slate-400">
                                {data.tests.length === 0
                                    ? "No assigned mocks yet."
                                    : "No tests match this batch or search."}
                            </div>
                        ) : (
                            visibleTests.map((test) => {
                                const action = getPrimaryAction(test);

                                return (
                                    <div key={test.id} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-6">
                                        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                                            <div className="space-y-4">
                                                <div>
                                                    <h3 className="font-serif text-2xl font-bold text-slate-900">{test.title}</h3>
                                                    {test.description && (
                                                        <p className="mt-2 text-sm leading-relaxed text-slate-500">{test.description}</p>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap gap-2">
                                                    <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
                                                        {test.questionCount} questions
                                                    </Badge>
                                                    <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
                                                        {test.durationMinutes} min
                                                    </Badge>
                                                    {test.assignedBatches.map((batch) => (
                                                        <Badge key={`${test.id}-${batch.id}`} className="rounded-full border-none bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                                                            {batch.name}
                                                        </Badge>
                                                    ))}
                                                    <Badge className="rounded-full border-none bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                                                        Attempt {getAttemptDisplayNumber(test)} of {MAX_ATTEMPTS}
                                                    </Badge>
                                                    {test.hasInProgressSession ? (
                                                        <Badge className="rounded-full border-none bg-indigo-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
                                                            Resume current attempt
                                                        </Badge>
                                                    ) : test.attemptsRemaining > 0 ? (
                                                        <Badge className="rounded-full border-none bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                                                            {test.attemptsRemaining} remaining
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="rounded-full border-none bg-rose-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-rose-700">
                                                            Attempt limit reached
                                                        </Badge>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Latest Attempt</div>
                                                        <div className="mt-1 font-semibold text-slate-900">
                                                            {test.latestAttempt
                                                                ? test.latestAttempt.status === "IN_PROGRESS"
                                                                    ? `Attempt ${test.latestAttempt.attemptNumber} in progress`
                                                                    : `${Math.round(test.latestAttempt.percentage ?? 0)}% on attempt ${test.latestAttempt.attemptNumber}`
                                                                : "No attempts yet"}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Best Attempt</div>
                                                        <div className="mt-1 font-semibold text-slate-900">
                                                            {test.bestAttempt
                                                                ? `${Math.round(test.bestAttempt.percentage ?? 0)}% on attempt ${test.bestAttempt.attemptNumber}`
                                                                : "No completed attempt yet"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex flex-col items-start gap-3 lg:items-end">
                                                {action ? (
                                                    <Button asChild className="rounded-xl bg-slate-900 px-6 font-bold text-white hover:bg-black">
                                                        <Link href={action.href}>{action.label}</Link>
                                                    </Button>
                                                ) : (
                                                    <Button disabled className="rounded-xl px-6 font-bold">
                                                        Attempt limit reached
                                                    </Button>
                                                )}
                                                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                                                    {test.attemptsUsed} used · {test.attemptsRemaining} remaining
                                                </span>
                                            </div>
                                        </div>

                                        <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border-soft)" }}>
                                            <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Attempt History</div>
                                            {test.attemptHistory.length === 0 ? (
                                                <div className="text-sm text-slate-400">No attempts started yet.</div>
                                            ) : (
                                                <div className="flex flex-wrap gap-2">
                                                    {test.attemptHistory.map((attempt) => {
                                                        const href = attempt.status === "IN_PROGRESS"
                                                            ? `/arena/${test.id}`
                                                            : `/student/results/${attempt.id}`;

                                                        return (
                                                            <Link
                                                                key={attempt.id}
                                                                href={href}
                                                                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-indigo-300 hover:text-indigo-700"
                                                            >
                                                                <Badge className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(attempt.status)}`}>
                                                                    {statusLabel(attempt.status)}
                                                                </Badge>
                                                                <span>Attempt {attempt.attemptNumber}</span>
                                                                {attempt.status !== "IN_PROGRESS" && (
                                                                    <span>{Math.round(attempt.percentage ?? 0)}%</span>
                                                                )}
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>

                <div className="flex flex-col gap-8">
                    <Card className="rounded-3xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                        <CardHeader className="border-b bg-surface p-6" style={{ borderColor: "var(--border-soft)" }}>
                            <CardTitle className="font-serif text-xl text-slate-800">Recent Attempts</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-6 p-6">
                            {data.recentAttempts.length === 0 ? (
                                <div className="py-8 text-center text-slate-400">No completed attempts yet.</div>
                            ) : (
                                data.recentAttempts.map((attempt) => {
                                    const percentage = attempt.percentage ?? 0;

                                    return (
                                        <div key={attempt.sessionId} className="flex flex-col gap-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <h4 className="font-serif text-lg font-bold text-slate-900">{attempt.testTitle}</h4>
                                                    <p className="mt-1 text-sm text-slate-500">
                                                        Attempt {attempt.attemptNumber} · {statusLabel(attempt.status)}
                                                    </p>
                                                </div>
                                                <Link href={`/student/results/${attempt.sessionId}`}>
                                                    <span className="rounded-md bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 transition-colors hover:bg-emerald-100">
                                                        View
                                                    </span>
                                                </Link>
                                            </div>
                                            <div className="text-sm text-slate-600">
                                                {attempt.score ?? 0}/{attempt.totalMarks} · {Math.round(percentage)}%
                                            </div>
                                            <Progress
                                                value={percentage}
                                                className="h-3 rounded-full bg-surface-2"
                                                indicatorClassName={`${percentage >= 80 ? "bg-emerald-500" : percentage >= 60 ? "bg-amber-500" : "bg-rose-500"} rounded-full`}
                                            />
                                        </div>
                                    );
                                })
                            )}
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="flex items-center gap-2 font-serif text-xl text-indigo-950">
                                <Sparkles className="h-5 w-5 text-indigo-500" />
                                Performance Snapshot
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 p-6 pt-2">
                            <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
                                <div className="text-[10px] font-bold uppercase tracking-wide text-indigo-500">Completed Attempts</div>
                                <div className="mt-2 text-3xl font-serif font-bold text-indigo-950">{data.stats.completedAttempts}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                                    <Trophy className="h-4 w-4" />
                                    Best Score
                                </div>
                                <div className="mt-2 text-3xl font-serif font-bold text-emerald-900">{data.stats.bestScore}%</div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                                {data.stats.activeAssignments > 0
                                    ? `You still have ${data.stats.activeAssignments} assigned test${data.stats.activeAssignments === 1 ? "" : "s"} with attempts available.`
                                    : "Every visible assigned mock has used all paid attempts."}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
