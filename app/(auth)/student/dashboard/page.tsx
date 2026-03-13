"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Sparkles, MoveRight } from "lucide-react";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";

type UpcomingTest = {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    scheduledAt: string | null;
    teacherName: string;
    questionCount: number;
};

type RecentResult = {
    testTitle: string;
    testId: string;
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    submittedAt: string | null;
    sessionId: string;
    hasFeedback: boolean;
    overallTag: string | null;
};

type DashboardStats = {
    totalTests: number;
    avgScore: number;
    bestScore: number;
};

type BatchInfo = {
    id: string;
    name: string;
    code: string;
};

type DashboardData = {
    upcoming: UpcomingTest[];
    recent: RecentResult[];
    stats: DashboardStats;
    batches: BatchInfo[];
};

function DashboardSkeleton() {
    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto pb-10">
            <div className="border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <Skeleton className="h-9 w-64 mb-2" />
                <Skeleton className="h-4 w-80" />
            </div>
            <Skeleton className="h-48 rounded-[2rem]" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Skeleton className="h-72 rounded-3xl" />
                <Skeleton className="h-72 rounded-3xl" />
            </div>
        </div>
    );
}

export default function StudentDashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentTime, setCurrentTime] = useState(() => Date.now());

    useEffect(() => {
        (async () => {
            const res = await apiClient.get<DashboardData>("/api/student/dashboard");
            if (res.ok) setData(res.data);
            setIsLoading(false);
        })();
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);

    if (isLoading || !data) return <DashboardSkeleton />;

    const nextTest = data.upcoming[0];
    const isNextTestAvailable = nextTest
        ? !nextTest.scheduledAt || new Date(nextTest.scheduledAt).getTime() <= currentTime
        : false;

    return (
        <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto pb-10">
            <div className="flex items-center justify-between border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Student Dashboard</h1>
                    <p className="text-slate-500 mt-1">Track your progress and upcoming assessments.</p>
                    {data.batches.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                            {data.batches.map((b) => (
                                <span key={b.id} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-semibold px-2.5 py-1 rounded-lg border border-indigo-100">
                                    {b.name} <span className="text-indigo-400 font-normal">({b.code})</span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Next Test Banner */}
            {nextTest ? (
                <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-500 via-indigo-600 to-indigo-800 p-8 md:p-10" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                    <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                        <div className="space-y-4 flex-1">
                            <Badge className="bg-white/20 hover:bg-white/30 text-white border-0 font-bold uppercase tracking-wider text-[10px] px-3 py-1 mb-2">Upcoming</Badge>
                            <h2 className="text-2xl md:text-3xl font-serif font-bold text-white leading-tight">{nextTest.title}</h2>
                            <div className="flex flex-col gap-1 text-indigo-100 text-sm font-medium">
                                <span>{nextTest.questionCount} Questions • {nextTest.durationMinutes} min</span>
                                <span>by {nextTest.teacherName}</span>
                            </div>
                            {nextTest.scheduledAt && (
                                <div className="flex items-center gap-2 text-indigo-100 text-sm mt-2">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(nextTest.scheduledAt).toLocaleString()}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col items-start md:items-end gap-4 shrink-0">
                            <Button
                                asChild={isNextTestAvailable}
                                disabled={!isNextTestAvailable}
                                className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-lg px-8 py-6 rounded-2xl shadow-clay-inner transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white"
                            >
                                {isNextTestAvailable ? (
                                    <Link href={`/arena/${nextTest.id}`}>
                                        Enter Test Arena <MoveRight className="ml-2 h-5 w-5" />
                                    </Link>
                                ) : (
                                    <span>Available At Scheduled Time</span>
                                )}
                            </Button>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 -mb-24 -ml-24 w-64 h-64 bg-emerald-400/20 rounded-full blur-3xl pointer-events-none" />
                </div>
            ) : (
                <div className="rounded-[2rem] bg-surface-2 p-8 text-center text-slate-500 font-medium" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                    No upcoming tests right now. Check back later!
                </div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: "Tests Taken", value: data.stats.totalTests },
                    { label: "Avg Score", value: `${data.stats.avgScore}%` },
                    { label: "Best Score", value: `${data.stats.bestScore}%` },
                ].map(s => (
                    <Card key={s.label} className="bg-white rounded-2xl border-0" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                        <CardContent className="p-5 text-center">
                            <div className="text-2xl font-serif font-bold text-slate-900">{s.value}</div>
                            <div className="text-xs text-slate-500 font-medium mt-1">{s.label}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Grid Layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* Recent Results */}
                <Card className="bg-white rounded-3xl border-0 flex flex-col h-full">
                    <CardHeader className="pb-4 p-8 border-b bg-surface" style={{ borderColor: "var(--border-soft)" }}>
                        <CardTitle className="text-xl font-serif font-bold text-slate-800">Recent Results</CardTitle>
                    </CardHeader>
                    <CardContent className="p-8 flex flex-col gap-8 flex-1">
                        {data.recent.length === 0 ? (
                            <div className="text-center text-slate-400 py-8">No results yet. Take a test!</div>
                        ) : (
                            data.recent.map((r, i) => {
                                const pct = r.percentage ?? 0;
                                return (
                                    <div key={i} className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="font-bold text-slate-800 text-base font-serif">{r.testTitle}</h4>
                                                <p className="text-sm text-slate-500 mt-1">Score: {Math.round(pct)}% ({r.score ?? 0}/{r.totalMarks})</p>
                                            </div>
                                            <Link href={`/student/results/${r.sessionId}`}>
                                                <span className="bg-emerald-50 text-emerald-700 font-bold uppercase text-[10px] tracking-wider px-3 py-1 rounded-md cursor-pointer hover:bg-emerald-100">View</span>
                                            </Link>
                                        </div>
                                        <Progress value={pct} className="h-3 rounded-full bg-surface-2" indicatorClassName={`${pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500'} rounded-full`} />
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>

                {/* AI Recommendations */}
                <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-3xl border border-indigo-100 overflow-hidden shadow-sm">
                    <CardHeader className="pb-3 p-6 border-b border-white/50 bg-white/50 backdrop-blur-sm">
                        <CardTitle className="text-lg font-serif font-bold text-indigo-900 flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-indigo-500" />
                            AI Study Recommendations
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-6">
                        <div className="flex flex-col gap-2">
                            {data.stats.totalTests > 0 ? (
                                <>
                                    <h4 className="font-bold text-indigo-900 text-sm font-serif">
                                        {data.stats.avgScore >= 80 ? "Great Performance!" : "Focus Areas Identified"}
                                    </h4>
                                    <p className="text-sm text-indigo-800/80 leading-relaxed">
                                        {data.stats.avgScore >= 80
                                            ? `You're averaging ${data.stats.avgScore}% across ${data.stats.totalTests} tests. Keep up the excellent work!`
                                            : `Your average across ${data.stats.totalTests} tests is ${data.stats.avgScore}%. Review topics from recent tests where you scored below 70%.`
                                        }
                                    </p>
                                </>
                            ) : (
                                <p className="text-sm text-indigo-800/80 leading-relaxed">
                                    Take your first test to get personalised study recommendations.
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
