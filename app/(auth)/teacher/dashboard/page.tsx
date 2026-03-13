"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Users, ArrowRight, Plus, AlertCircle, BookOpen } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api-client";

type TestItem = {
    id: string;
    title: string;
    status: string;
    questionCount: number;
    attemptCount: number;
    durationMinutes: number;
    createdAt: string;
};

type TestsResponse = {
    tests: TestItem[];
    total: number;
};

type BatchItem = {
    id: string;
    name: string;
    code: string;
    status: string;
    studentCount: number;
};

type DashboardResponse = {
    status: string;
    batches: BatchItem[];
    testStats: {
        total: number;
        published: number;
        drafts: number;
        totalAttempts: number;
    };
};

function DashboardSkeleton() {
    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div className="border-b pb-6" style={{ borderColor: 'var(--border-soft)' }}>
                <Skeleton className="h-9 w-64 mb-2" />
                <Skeleton className="h-4 w-80" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-56 rounded-3xl" />)}
            </div>
        </div>
    );
}

export default function TeacherDashboard() {
    const [isLoading, setIsLoading] = useState(true);
    const [tests, setTests] = useState<TestItem[]>([]);
    const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null);

    useEffect(() => {
        (async () => {
            const [testsRes, dashRes] = await Promise.all([
                apiClient.get<TestsResponse>("/api/teacher/tests"),
                apiClient.get<DashboardResponse>("/api/teacher/dashboard")
            ]);

            if (testsRes.ok) setTests(testsRes.data.tests);
            if (dashRes.ok) setDashboardData(dashRes.data);

            setIsLoading(false);
        })();
    }, []);

    if (isLoading) return <DashboardSkeleton />;

    if (dashboardData?.status !== "ACTIVE") {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 w-full max-w-2xl mx-auto text-center">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-2 shadow-clay-inner">
                    <AlertCircle className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-serif font-bold text-slate-900">Account Suspended</h1>
                <p className="text-slate-500 text-lg">
                    You are not a valid member. Your teacher account is currently inactive or suspended.
                    Please contact an administrator to restore your access.
                </p>
            </div>
        );
    }

    const draftCount = dashboardData?.testStats.drafts || tests.filter(t => t.status === "DRAFT").length;
    const publishedCount = dashboardData?.testStats.published || tests.filter(t => t.status === "PUBLISHED").length;

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b pb-6 gap-4" style={{ borderColor: 'var(--border-soft)' }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Teacher Dashboard</h1>
                    <p className="text-slate-500 mt-1">Overview of your tests and student activity.</p>
                </div>
                <Link href="/teacher/tests/create">
                    <Button className="bg-primary hover:bg-primary/90 text-white shadow-clay-inner rounded-xl h-11 px-5 font-bold">
                        <Plus className="h-4 w-4 mr-2" />
                        Create New Test
                    </Button>
                </Link>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-indigo-600 text-white rounded-3xl border-0 overflow-hidden relative shadow-clay-outer">
                    <div className="absolute right-0 top-0 opacity-10">
                        <Clock className="w-32 h-32 -mr-8 -mt-8" />
                    </div>
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2 z-10 relative">
                        <CardTitle className="text-sm font-medium text-indigo-100">Total Tests</CardTitle>
                        <Clock className="h-4 w-4 text-indigo-200" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0 z-10 relative">
                        <div className="text-4xl font-serif font-bold mt-1">{dashboardData?.testStats.total || 0}</div>
                        <p className="text-xs text-indigo-200 mt-1">{publishedCount} published · {draftCount} draft</p>
                    </CardContent>
                </Card>

                <Card className="bg-white rounded-3xl border-0 shadow-clay-outer">
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500">Total Attempts</CardTitle>
                        <Users className="h-5 w-5 text-emerald-500" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <div className="text-4xl font-serif font-bold text-slate-900">{dashboardData?.testStats.totalAttempts || 0}</div>
                        <p className="text-xs text-slate-500 mt-1">Across all tests</p>
                    </CardContent>
                </Card>

                <Card className="bg-white rounded-3xl border-0 shadow-clay-outer">
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500">Published Tests</CardTitle>
                        <Clock className="h-5 w-5 text-amber-500" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <div className="text-4xl font-serif font-bold text-slate-900">{publishedCount}</div>
                        <p className="text-xs text-slate-500 mt-1">Available for students</p>
                    </CardContent>
                </Card>
            </div>

            {/* Allocated Batches Row */}
            <div className="pt-4">
                <h2 className="text-xl font-serif font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    Your Allocated Batches
                </h2>
                {!dashboardData?.batches || dashboardData.batches.length === 0 ? (
                    <Card className="bg-surface-2 rounded-3xl border-0 p-8 text-center text-slate-400">
                        You have not been assigned any batches yet.
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {dashboardData.batches.map(batch => (
                            <Card key={batch.id} className="bg-white rounded-3xl border-0 shadow-sm border-2 border-transparent hover:border-indigo-100 transition-colors flex flex-col">
                                <CardHeader className="p-5 pb-2">
                                    <div className="flex justify-between items-start mb-1">
                                        <Badge variant="outline" className={`border-none px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${batch.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' :
                                                batch.status === 'UPCOMING' ? 'bg-indigo-50 text-indigo-700' :
                                                    'bg-slate-100 text-slate-500'
                                            }`}>{batch.status}</Badge>
                                        <span className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{batch.code}</span>
                                    </div>
                                    <CardTitle className="font-serif text-lg leading-tight mt-1 truncate">{batch.name}</CardTitle>
                                </CardHeader>
                                <CardContent className="p-5 pt-3">
                                    <div className="flex items-center text-sm font-medium text-slate-600 bg-surface-2 p-3 rounded-xl">
                                        <Users className="w-4 h-4 mr-2 text-indigo-400" />
                                        {batch.studentCount} {batch.studentCount === 1 ? 'Student' : 'Students'} Enrolled
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Tests as cards */}
            <div className="pt-4">
                <h2 className="text-xl font-serif font-bold text-slate-900 mb-4">Your Tests</h2>
                {tests.length === 0 ? (
                    <Card className="bg-surface-2 rounded-3xl border-0 p-12 text-center text-slate-400">
                        No tests yet. Create your first test to get started!
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {tests.map(test => (
                            <Card key={test.id} className="bg-white rounded-3xl border-0 shadow-clay-outer flex flex-col group cursor-pointer hover:-translate-y-1 transition-transform duration-200">
                                <CardHeader className="p-6 pb-2">
                                    <div className="flex justify-between items-start mb-2">
                                        <Badge variant="outline" className={`border-none px-2 py-0.5 text-xs font-bold ${test.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' :
                                            test.status === 'DRAFT' ? 'bg-amber-50 text-amber-700' :
                                                'bg-slate-100 text-slate-500'
                                            }`}>{test.status}</Badge>
                                        <span className="text-xs text-slate-400">{test.durationMinutes} min</span>
                                    </div>
                                    <CardTitle className="font-serif text-xl">{test.title}</CardTitle>
                                    <CardDescription className="text-slate-500 font-medium">{test.questionCount} Questions</CardDescription>
                                </CardHeader>
                                <CardContent className="p-6 pt-4 flex-1">
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500">Attempts:</span>
                                            <span className="font-bold text-slate-900">{test.attemptCount}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="text-slate-500">Created:</span>
                                            <span className="font-bold text-slate-900">{new Date(test.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </CardContent>
                                <CardFooter className="p-6 pt-0 gap-2">
                                    <Link href={`/teacher/tests/${test.id}/analytics`} className="flex-1">
                                        <Button className="w-full bg-surface-2 hover:bg-primary hover:text-white text-slate-700 border-transparent shadow-none font-bold rounded-xl h-11 transition-colors group-hover:shadow-clay-inner">
                                            Analytics <ArrowRight className="h-4 w-4 ml-2" />
                                        </Button>
                                    </Link>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
