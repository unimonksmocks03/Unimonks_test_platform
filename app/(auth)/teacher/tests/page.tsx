"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

type TestItem = {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    status: string;
    source: string;
    scheduledAt: string | null;
    scheduledEndAt: string | null;
    retentionExpiresAt: string | null;
    isFinished: boolean;
    canDelete: boolean;
    hasActiveSessions: boolean;
    questionCount: number;
    attemptCount: number;
    createdAt: string;
};

type TestsResponse = {
    tests: TestItem[];
    total: number;
    page: number;
    totalPages: number;
};

export default function MyTestsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [tests, setTests] = useState<TestItem[]>([]);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

    const fetchTests = async () => {
        setIsLoading(true);
        const res = await apiClient.get<TestsResponse>("/api/teacher/tests");
        if (res.ok) {
            // Sort: active scheduled first, then drafts/unscheduled, finished tests last.
            const sorted = res.data.tests.sort((a, b) => {
                if (a.isFinished !== b.isFinished) return a.isFinished ? 1 : -1;
                if (a.scheduledAt && b.scheduledAt) return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
                if (a.scheduledAt) return -1;
                if (b.scheduledAt) return 1;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            setTests(sorted);
        }
        setIsLoading(false);
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial data fetch
    useEffect(() => { fetchTests(); }, []);

    const handleDelete = (id: string, title: string) => {
        setDeleteTarget({ id, title });
    };

    const handlePermanentDelete = async () => {
        if (!deleteTarget) return;
        console.log('[DELETE] Attempting to delete test:', deleteTarget.id, deleteTarget.title);
        const res = await apiClient.delete(`/api/teacher/tests/${deleteTarget.id}`);
        if (res.ok) {
            toast.success("Test deleted", { description: `"${deleteTarget.title}" has been removed.` });
            setTests(prev => prev.filter(t => t.id !== deleteTarget.id));
            setDeleteTarget(null);
        } else {
            toast.error("Failed to delete", { description: res.message || "Only draft or finished published tests can be deleted." });
        }
    };

    const statusBadge = (status: string) => {
        const s = status.toLowerCase();
        if (s === "published") return "bg-indigo-50 text-indigo-700 border-none";
        if (s === "draft") return "bg-amber-50 text-amber-700 border-none";
        return "bg-emerald-50 text-emerald-700 border-none";
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
            <div className="flex items-center justify-between border-b pb-6" style={{ borderColor: 'var(--border-soft)' }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">My Tests</h1>
                    <p className="text-slate-500 mt-1">View and manage all your created tests.</p>
                </div>
                <Link href="/teacher/tests/create">
                    <Button className="flex items-center gap-2 rounded-xl px-6 h-12 shadow-clay-inner font-bold text-base">
                        <Plus className="h-4 w-4" />
                        Create New Test
                    </Button>
                </Link>
            </div>

            <Card className="bg-white border-0 rounded-3xl overflow-hidden" style={{ boxShadow: 'var(--shadow-clay-outer)' }}>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/80">
                            <TableRow>
                                <TableHead className="font-semibold text-slate-700 w-[200px] pl-6">Test Name</TableHead>
                                <TableHead className="font-semibold text-slate-700">Scheduled</TableHead>
                                <TableHead className="font-semibold text-slate-700">Duration</TableHead>
                                <TableHead className="font-semibold text-slate-700">Questions</TableHead>
                                <TableHead className="font-semibold text-slate-700">Status</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-center">Attempts</TableHead>
                                <TableHead className="text-right pr-6 font-semibold text-slate-700">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [1, 2, 3].map((i) => (
                                    <TableRow key={`skeleton-${i}`}>
                                        <TableCell className="pl-6"><Skeleton className="h-5 w-40 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-20 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-12 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                                        <TableCell className="text-center"><Skeleton className="h-4 w-8 mx-auto rounded-md" /></TableCell>
                                        <TableCell className="text-right pr-6 flex justify-end gap-2">
                                            <Skeleton className="h-8 w-14 rounded-lg" />
                                            <Skeleton className="h-8 w-20 rounded-lg" />
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : tests.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12 text-slate-400">
                                        No tests yet. Create your first test!
                                    </TableCell>
                                </TableRow>
                            ) : (
                                tests.map((test) => (
                                    <TableRow key={test.id} className="group">
                                        <TableCell className="font-medium text-slate-900 pl-6">
                                            <div className="flex flex-col gap-1">
                                                <span>{test.title}</span>
                                                {test.isFinished && (
                                                    <span className="inline-flex w-fit items-center rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                                                        Test finished
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-slate-600 text-sm">
                                            <div className="flex flex-col gap-1">
                                                <span>
                                                    {test.scheduledAt ? new Date(test.scheduledAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : <span className="text-slate-400">Not set</span>}
                                                </span>
                                                {test.isFinished && test.retentionExpiresAt && (
                                                    <span className="text-[11px] font-medium text-rose-600">
                                                        Auto deletes {new Date(test.retentionExpiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-slate-600">
                                            {test.durationMinutes} min
                                        </TableCell>
                                        <TableCell className="text-slate-600 font-bold">
                                            {test.questionCount}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <Badge
                                                    variant="secondary"
                                                    className={`w-fit shadow-none font-bold tracking-wide uppercase text-[10px] px-2.5 py-1 rounded-full ${statusBadge(test.status)}`}
                                                >
                                                    {test.status}
                                                </Badge>
                                                {test.isFinished && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="w-fit bg-rose-50 text-rose-700 border-none shadow-none font-bold tracking-wide uppercase text-[10px] px-2.5 py-1 rounded-full"
                                                    >
                                                        Finished
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-bold text-slate-700 text-center">{test.attemptCount}</TableCell>
                                        <TableCell className="text-right pr-6 flex justify-end gap-2">
                                            <Link href={`/teacher/tests/create?edit=${test.id}`}>
                                                <Button variant="outline" size="sm" className="h-8 shadow-sm rounded-lg hover:text-primary transition-colors">
                                                    Edit
                                                </Button>
                                            </Link>
                                            <Link href={`/teacher/tests/${test.id}/analytics`}>
                                                <Button variant="secondary" size="sm" className="h-8 shadow-sm rounded-lg bg-indigo-50 text-indigo-700 font-bold hover:bg-indigo-100 hover:shadow-inner">
                                                    Analytics
                                                </Button>
                                            </Link>
                                            {test.canDelete && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 px-2 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        handleDelete(test.id, test.title);
                                                    }}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <DeleteConfirmDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                itemName={deleteTarget?.title || ""}
                itemType="test"
                showDisableOption={false}
                onPermanentDelete={handlePermanentDelete}
            />
        </div>
    );
}
