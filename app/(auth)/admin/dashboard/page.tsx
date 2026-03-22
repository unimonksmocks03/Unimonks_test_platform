"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Inbox, Repeat, Users, Zap } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type OverviewData = {
    users: {
        admin: number;
        student: number;
    };
    tests: {
        total: number;
        draft: number;
        published: number;
        archived: number;
    };
    attempts: {
        total: number;
        active: number;
    };
    leads: {
        actionable: number;
        unreviewed: number;
        reviewedToday: number;
    };
    avgScore: number;
};

export default function AdminDashboardPage() {
    const [data, setData] = useState<OverviewData | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const response = await apiClient.get<OverviewData>("/api/admin/analytics/overview");

            if (response.ok) {
                setData(response.data);
            }

            setIsLoading(false);
        })();
    }, []);

    if (isLoading) {
        return (
            <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-10">
                <div className="border-b pb-6" style={{ borderColor: "var(--border-soft)" }}>
                    <Skeleton className="h-9 w-64 mb-2" />
                    <Skeleton className="h-4 w-80" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-6">
                    {[1, 2, 3, 4, 5, 6].map((index) => (
                        <Skeleton key={index} className="h-36 rounded-2xl" />
                    ))}
                </div>
            </div>
        );
    }

    const dashboard = data ?? {
        users: { admin: 0, student: 0 },
        tests: { total: 0, draft: 0, published: 0, archived: 0 },
        attempts: { total: 0, active: 0 },
        leads: { actionable: 0, unreviewed: 0, reviewedToday: 0 },
        avgScore: 0,
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-10">
            <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Admin Overview</h1>
                    <p className="mt-1 text-slate-500">Student, attempt, and lead visibility across the platform.</p>
                </div>
                <Badge variant="outline" className="w-fit rounded-xl px-4 py-2 text-sm font-bold">
                    {dashboard.users.admin} admin
                </Badge>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-6">
                {[
                    {
                        label: "Total Students",
                        value: dashboard.users.student.toLocaleString(),
                        icon: <Users className="h-4 w-4 text-indigo-200" />,
                        className: "bg-gradient-to-br from-indigo-500 to-indigo-700 text-white",
                        description: `${dashboard.users.admin} active admin`,
                    },
                    {
                        label: "Total Tests",
                        value: dashboard.tests.total.toLocaleString(),
                        icon: <BookOpen className="h-4 w-4 text-amber-500" />,
                        className: "bg-white",
                        description: `${dashboard.tests.published} published`,
                    },
                    {
                        label: "Total Attempts",
                        value: dashboard.attempts.total.toLocaleString(),
                        icon: <Repeat className="h-4 w-4 text-violet-500" />,
                        className: "bg-white",
                        description: `Avg score ${dashboard.avgScore}%`,
                    },
                    {
                        label: "Active Sessions",
                        value: dashboard.attempts.active.toLocaleString(),
                        icon: <Zap className="h-4 w-4 text-emerald-500" />,
                        className: "bg-white",
                        description: "Currently in progress",
                    },
                    {
                        label: "New Leads",
                        value: dashboard.leads.unreviewed.toLocaleString(),
                        icon: <Inbox className="h-4 w-4 text-sky-500" />,
                        className: "bg-white",
                        description: `${dashboard.leads.actionable} visible total`,
                    },
                    {
                        label: "Reviewed Today",
                        value: dashboard.leads.reviewedToday.toLocaleString(),
                        icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
                        className: "bg-white",
                        description: "Lead queue throughput",
                    },
                ].map((metric) => (
                    <Card
                        key={metric.label}
                        className={`rounded-2xl border-0 shadow-sm ${metric.className}`}
                    >
                        <CardHeader className="p-6 pb-2">
                            <CardTitle className={`flex items-center justify-between text-sm font-medium ${metric.className.includes("text-white") ? "text-indigo-100" : "text-slate-500"}`}>
                                {metric.label}
                                {metric.icon}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-0">
                            <div className={`text-4xl font-serif font-bold ${metric.className.includes("text-white") ? "text-white" : "text-slate-900"}`}>
                                {metric.value}
                            </div>
                            <p className={`mt-1 text-xs ${metric.className.includes("text-white") ? "text-indigo-100" : "text-slate-500"}`}>
                                {metric.description}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card className="rounded-3xl border-0 bg-white shadow-sm">
                    <CardHeader className="p-6 pb-2">
                        <CardTitle className="font-serif">Test Status Snapshot</CardTitle>
                        <CardDescription>Published tests remain immediately available once released.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 p-6 pt-4">
                        {[
                            { label: "Published", count: dashboard.tests.published, color: "bg-emerald-500" },
                            { label: "Draft", count: dashboard.tests.draft, color: "bg-amber-500" },
                            { label: "Archived", count: dashboard.tests.archived, color: "bg-slate-400" },
                        ].map((item) => (
                            <div key={item.label} className="flex items-center gap-4">
                                <div className={`h-3 w-3 rounded-full ${item.color}`} />
                                <span className="w-24 text-sm font-medium text-slate-700">{item.label}</span>
                                <div className="h-2 flex-1 rounded-full bg-slate-100">
                                    <div
                                        className={`h-2 rounded-full ${item.color}`}
                                        style={{ width: `${dashboard.tests.total > 0 ? (item.count / dashboard.tests.total) * 100 : 0}%` }}
                                    />
                                </div>
                                <span className="w-12 text-right text-sm font-bold text-slate-900">{item.count}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <Card className="rounded-3xl border-0 bg-white shadow-sm">
                    <CardHeader className="p-6 pb-2">
                        <CardTitle className="font-serif">Lead Queue Visibility</CardTitle>
                        <CardDescription>Already-enrolled student emails are excluded from the actionable queue.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 p-6 pt-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Visible Actionable Leads</div>
                            <div className="mt-2 text-3xl font-serif font-bold text-slate-900">{dashboard.leads.actionable}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Unreviewed</div>
                                <div className="mt-2 text-2xl font-serif font-bold text-amber-900">{dashboard.leads.unreviewed}</div>
                            </div>
                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Reviewed Today</div>
                                <div className="mt-2 text-2xl font-serif font-bold text-emerald-900">{dashboard.leads.reviewedToday}</div>
                            </div>
                        </div>
                        <Link href="/admin/leads" className="inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                            Open lead queue →
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
