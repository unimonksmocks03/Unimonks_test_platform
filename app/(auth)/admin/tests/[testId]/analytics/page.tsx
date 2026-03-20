"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, AlertTriangle, BarChart3, CheckCircle2, Repeat, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";

type AttemptSummary = {
    id: string;
    attemptNumber: number;
    status: "SUBMITTED" | "TIMED_OUT" | "FORCE_SUBMITTED";
    score: number | null;
    totalMarks: number;
    percentage: number | null;
    startedAt: string;
    submittedAt: string | null;
};

type StudentSummary = {
    studentId: string;
    name: string;
    email: string;
    attemptsUsed: number;
    latestAttempt: AttemptSummary | null;
    bestAttempt: AttemptSummary | null;
    attemptHistory: AttemptSummary[];
};

type QuestionStat = {
    questionId: string;
    order: number;
    stem: string;
    difficulty: string | null;
    topic: string | null;
    correctRate: number;
    totalAttempts: number;
    allAttemptTotalAttempts: number;
    optionBreakdown: Array<{
        id: string;
        text: string;
        count: number;
        isCorrect: boolean;
    }>;
    allAttemptOptionBreakdown: Array<{
        id: string;
        text: string;
        count: number;
        isCorrect: boolean;
    }>;
    mostSelectedWrongOption: {
        id: string;
        text: string;
        count: number;
    } | null;
};

type AnalyticsData = {
    test: {
        id: string;
        title: string;
        durationMinutes: number;
        questionCount: number;
    };
    overview: {
        totalAttempts: number;
        uniqueStudents: number;
        avgScore: number;
        median: number;
        passRate: number;
        distribution: Record<string, number>;
    };
    topStudents: Array<{
        id: string;
        name: string;
        score: number | null;
        percentage: number | null;
        attemptNumber: number;
    }>;
    bottomStudents: Array<{
        id: string;
        name: string;
        score: number | null;
        percentage: number | null;
        attemptNumber: number;
    }>;
    studentSummaries: StudentSummary[];
    questionStats: QuestionStat[];
};

function statusBadgeClass(status: AttemptSummary["status"]) {
    if (status === "SUBMITTED") return "bg-emerald-50 text-emerald-700 border-none";
    if (status === "FORCE_SUBMITTED") return "bg-amber-50 text-amber-700 border-none";
    return "bg-rose-50 text-rose-700 border-none";
}

function statusLabel(status: AttemptSummary["status"]) {
    if (status === "FORCE_SUBMITTED") return "Force Submitted";
    if (status === "TIMED_OUT") return "Timed Out";
    return "Submitted";
}

export default function AdminTestAnalyticsPage() {
    const params = useParams();
    const testId = params?.testId as string;

    const [data, setData] = useState<AnalyticsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const response = await apiClient.get<AnalyticsData>(`/api/admin/tests/${testId}/analytics`);

            if (response.ok) {
                setData(response.data);
            } else {
                setError(response.message || "Failed to load analytics");
            }

            setIsLoading(false);
        })();
    }, [testId]);

    const distributionData = data
        ? [
            { range: "0-20%", count: data.overview.distribution["0-20"] || 0 },
            { range: "21-40%", count: data.overview.distribution["21-40"] || 0 },
            { range: "41-60%", count: data.overview.distribution["41-60"] || 0 },
            { range: "61-80%", count: data.overview.distribution["61-80"] || 0 },
            { range: "81-100%", count: data.overview.distribution["81-100"] || 0 },
        ]
        : [];

    if (isLoading) {
        return (
            <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="h-9 w-72 rounded-md" />
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                    {[1, 2, 3, 4, 5].map((index) => (
                        <Skeleton key={index} className="h-28 rounded-3xl" />
                    ))}
                </div>
                <Skeleton className="h-80 rounded-3xl" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex flex-col items-center py-20">
                <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
                <h2 className="text-xl font-serif font-bold text-slate-900 mb-2">Analytics Unavailable</h2>
                <p className="text-slate-500 mb-6">{error || "No analytics data is available for this test."}</p>
                <Button asChild variant="outline" className="rounded-xl">
                    <Link href="/admin/tests">Back to Tests</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div className="flex flex-col gap-4 border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                <Link href="/admin/tests" className="text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold transition-colors w-fit">
                    <ArrowLeft className="h-4 w-4" /> Back to Tests
                </Link>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">{data.test.title}</h1>
                    <p className="mt-1 text-slate-500">
                        Latest completed attempts drive summary rankings and per-question accuracy. Full attempt history is available below.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
                {[
                    { label: "Latest Avg Score", value: `${data.overview.avgScore}%`, icon: <BarChart3 className="h-4 w-4 text-indigo-500" /> },
                    { label: "Total Attempts", value: data.overview.totalAttempts, icon: <Repeat className="h-4 w-4 text-violet-500" /> },
                    { label: "Unique Students", value: data.overview.uniqueStudents, icon: <Users className="h-4 w-4 text-emerald-500" /> },
                    { label: "Pass Rate", value: `${data.overview.passRate}%`, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" /> },
                    { label: "Median", value: `${data.overview.median}%`, icon: <BarChart3 className="h-4 w-4 text-amber-500" /> },
                ].map((item) => (
                    <Card key={item.label} className="rounded-2xl border-0 bg-white shadow-sm">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="flex items-center justify-between text-sm font-medium text-slate-500">
                                {item.label}
                                {item.icon}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            <div className="text-4xl font-serif font-bold text-slate-900">{item.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Tabs defaultValue="overview" className="w-full">
                <TabsList className="bg-surface-2 p-1 rounded-xl">
                    <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Overview</TabsTrigger>
                    <TabsTrigger value="students" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Students</TabsTrigger>
                    <TabsTrigger value="questions" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Questions</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6 space-y-6">
                    <Card className="rounded-3xl border-0 bg-white shadow-sm">
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className="font-serif text-xl">Latest-Attempt Score Distribution</CardTitle>
                            <CardDescription>Each student contributes their most recent completed attempt to this summary.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            {data.overview.uniqueStudents === 0 ? (
                                <div className="py-16 text-center text-slate-400">No completed attempts yet.</div>
                            ) : (
                                <div className="mt-4 h-[320px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                            <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                                            <Tooltip cursor={{ fill: "#F1F5F9" }} contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                                            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                                                {distributionData.map((entry, index) => (
                                                    <Cell
                                                        key={`distribution-${index}`}
                                                        fill={entry.count === Math.max(...distributionData.map((item) => item.count)) ? "#4F46E5" : "#94A3B8"}
                                                    />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <Card className="rounded-3xl border-0 bg-white shadow-sm overflow-hidden">
                            <CardHeader className="border-b bg-emerald-50/60 p-6" style={{ borderColor: "var(--border-soft)" }}>
                                <CardTitle className="font-serif text-xl text-emerald-900">Top Latest Attempts</CardTitle>
                            </CardHeader>
                            <Table>
                                <TableHeader className="bg-slate-50/70">
                                    <TableRow>
                                        <TableHead className="pl-6 font-semibold text-slate-700">Student</TableHead>
                                        <TableHead className="text-right pr-6 font-semibold text-slate-700">Latest Score</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.topStudents.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={2} className="py-10 text-center text-slate-400">No data yet</TableCell>
                                        </TableRow>
                                    ) : (
                                        data.topStudents.map((student) => (
                                            <TableRow key={student.id}>
                                                <TableCell className="pl-6">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-medium text-slate-900">{student.name}</span>
                                                        <span className="text-xs text-slate-400">Attempt {student.attemptNumber}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="pr-6 text-right font-bold text-emerald-600">
                                                    {Math.round(student.percentage ?? 0)}%
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Card>

                        <Card className="rounded-3xl border-0 bg-white shadow-sm overflow-hidden">
                            <CardHeader className="border-b bg-rose-50/60 p-6" style={{ borderColor: "var(--border-soft)" }}>
                                <CardTitle className="font-serif text-xl text-rose-900">Needs Attention</CardTitle>
                            </CardHeader>
                            <Table>
                                <TableHeader className="bg-slate-50/70">
                                    <TableRow>
                                        <TableHead className="pl-6 font-semibold text-slate-700">Student</TableHead>
                                        <TableHead className="text-right pr-6 font-semibold text-slate-700">Latest Score</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data.bottomStudents.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={2} className="py-10 text-center text-slate-400">No data yet</TableCell>
                                        </TableRow>
                                    ) : (
                                        data.bottomStudents.map((student) => (
                                            <TableRow key={student.id}>
                                                <TableCell className="pl-6">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-medium text-slate-900">{student.name}</span>
                                                        <span className="text-xs text-slate-400">Attempt {student.attemptNumber}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="pr-6 text-right font-bold text-rose-600">
                                                    {Math.round(student.percentage ?? 0)}%
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="students" className="mt-6">
                    <Card className="rounded-3xl border-0 bg-white shadow-sm">
                        <CardHeader className="border-b p-6" style={{ borderColor: "var(--border-soft)" }}>
                            <CardTitle className="font-serif text-xl text-slate-900">Full Attempt History</CardTitle>
                            <CardDescription>
                                Latest attempt drives the summary cards above. Expand a student to review every completed attempt in order.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            {data.studentSummaries.length === 0 ? (
                                <div className="py-12 text-center text-slate-400">No completed attempts yet.</div>
                            ) : (
                                <Accordion type="multiple" className="space-y-4">
                                    {data.studentSummaries.map((student) => (
                                        <AccordionItem
                                            key={student.studentId}
                                            value={student.studentId}
                                            className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70"
                                        >
                                            <AccordionTrigger className="px-5 py-4 hover:no-underline">
                                                <div className="flex w-full flex-col gap-3 text-left md:flex-row md:items-center md:justify-between">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="font-serif text-lg font-bold text-slate-900">{student.name}</span>
                                                        <span className="text-sm text-slate-500">{student.email}</span>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-bold">
                                                            {student.attemptsUsed} attempt{student.attemptsUsed === 1 ? "" : "s"}
                                                        </Badge>
                                                        {student.latestAttempt && (
                                                            <Badge className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 border-none">
                                                                Latest: {Math.round(student.latestAttempt.percentage ?? 0)}%
                                                            </Badge>
                                                        )}
                                                        {student.bestAttempt && (
                                                            <Badge className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border-none">
                                                                Best: {Math.round(student.bestAttempt.percentage ?? 0)}%
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="border-t border-slate-200 bg-white px-5 pb-5 pt-4">
                                                <div className="space-y-3">
                                                    {student.attemptHistory.map((attempt) => (
                                                        <div
                                                            key={attempt.id}
                                                            className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between"
                                                        >
                                                            <div className="flex flex-col gap-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-slate-900">Attempt {attempt.attemptNumber}</span>
                                                                    <Badge className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(attempt.status)}`}>
                                                                        {statusLabel(attempt.status)}
                                                                    </Badge>
                                                                </div>
                                                                <span className="text-sm text-slate-500">
                                                                    Submitted {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : "—"}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                                                                <span className="font-medium text-slate-800">
                                                                    {Math.round(attempt.percentage ?? 0)}%
                                                                </span>
                                                                <span>
                                                                    {attempt.score ?? 0}/{attempt.totalMarks}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="questions" className="mt-6">
                    <Card className="rounded-3xl border-0 bg-white shadow-sm">
                        <CardHeader className="border-b p-6" style={{ borderColor: "var(--border-soft)" }}>
                            <CardTitle className="font-serif text-xl text-slate-900">Per-Question Summary</CardTitle>
                            <CardDescription>
                                Correctness and option counts use the latest completed attempt per student, with all-attempt totals shown for drilldown.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            {data.questionStats.length === 0 ? (
                                <div className="py-12 text-center text-slate-400">No question-level data yet.</div>
                            ) : (
                                <div className="space-y-4">
                                    {data.questionStats
                                        .slice()
                                        .sort((left, right) => left.correctRate - right.correctRate)
                                        .map((question) => (
                                            <div key={question.questionId} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                                                <div className="flex flex-col gap-3 border-b pb-4" style={{ borderColor: "var(--border-soft)" }}>
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <Badge className="rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 border-none">
                                                            {question.correctRate}% correct
                                                        </Badge>
                                                        {question.topic && (
                                                            <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide">
                                                                {question.topic}
                                                            </Badge>
                                                        )}
                                                        {question.difficulty && (
                                                            <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide">
                                                                {question.difficulty}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-serif text-lg font-bold text-slate-900">
                                                            Q{question.order}. {question.stem}
                                                        </p>
                                                        <p className="mt-1 text-sm text-slate-500">
                                                            Latest-attempt responses: {question.totalAttempts} · All completed-attempt responses: {question.allAttemptTotalAttempts}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
                                                    <div>
                                                        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">Latest Attempt Breakdown</h3>
                                                        <div className="space-y-2">
                                                            {question.optionBreakdown.map((option) => (
                                                                <div key={`${question.questionId}-latest-${option.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-semibold text-slate-900">{option.id}</span>
                                                                        <span className="text-sm text-slate-600">{option.text}</span>
                                                                        {option.isCorrect && (
                                                                            <Badge className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 border-none">
                                                                                Correct
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                    <span className="font-bold text-slate-900">{option.count}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">All Attempt Breakdown</h3>
                                                        <div className="space-y-2">
                                                            {question.allAttemptOptionBreakdown.map((option) => (
                                                                <div key={`${question.questionId}-all-${option.id}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="font-semibold text-slate-900">{option.id}</span>
                                                                        <span className="text-sm text-slate-600">{option.text}</span>
                                                                    </div>
                                                                    <span className="font-bold text-slate-900">{option.count}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {question.mostSelectedWrongOption && (
                                                            <p className="mt-3 text-sm text-amber-700">
                                                                Most selected wrong option in latest-attempt summary: {question.mostSelectedWrongOption.id} ({question.mostSelectedWrongOption.count})
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
