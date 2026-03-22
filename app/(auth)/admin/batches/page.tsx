"use client";

import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Edit, Users, Trash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
    SheetTrigger, SheetClose
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

type BatchItem = {
    id: string;
    name: string;
    code: string;
    kind: "FREE_SYSTEM" | "STANDARD";
    status: string;
    studentCount: number;
    createdAt: string;
};

type BatchesResponse = {
    batches: BatchItem[];
    total: number;
    page: number;
    totalPages: number;
};

export default function AdminBatchesPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [batches, setBatches] = useState<BatchItem[]>([]);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [createSheetOpen, setCreateSheetOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    const fetchBatches = useCallback(async (search?: string, status?: string) => {
        setIsLoading(true);
        const params: Record<string, string | number | undefined> = {};
        if (search) params.search = search;
        if (status && status !== "all") params.status = status.toUpperCase();

        const res = await apiClient.get<BatchesResponse>("/api/admin/batches", params);
        if (res.ok) {
            setBatches(res.data.batches);
            setTotal(res.data.total);
        } else {
            toast.error("Failed to load batches", { description: res.message });
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial data fetch on mount
        fetchBatches();
    }, [fetchBatches]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchBatches(searchQuery, statusFilter);
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [searchQuery, statusFilter, fetchBatches]);

    const handleCreateBatch = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setCreating(true);
        const fd = new FormData(e.currentTarget);
        const body = {
            name: fd.get("batch-name") as string,
            code: (fd.get("batch-code") as string).toUpperCase(),
        };

        const res = await apiClient.post("/api/admin/batches", body);
        if (res.ok) {
            toast.success("Batch Created", { description: `${body.name} has been created.` });
            setCreateSheetOpen(false);
            fetchBatches(searchQuery, statusFilter);
        } else {
            toast.error("Failed to create batch", { description: res.message });
        }
        setCreating(false);
    };

    const handleDisableBatch = async () => {
        if (!deleteTarget) return;
        const res = await apiClient.patch(`/api/admin/batches/${deleteTarget.id}`, { status: "COMPLETED" });
        if (res.ok) {
            toast.success("Batch Disabled", { description: `${deleteTarget.name} marked as completed.` });
            fetchBatches(searchQuery, statusFilter);
        } else {
            toast.error("Failed to disable batch", { description: res.message });
        }
    };

    const handlePermanentDelete = async () => {
        if (!deleteTarget) return;
        const res = await apiClient.delete(`/api/admin/batches/${deleteTarget.id}?permanent=true`);
        if (res.ok) {
            toast.success("Batch Deleted", { description: `${deleteTarget.name} has been deleted.` });
            fetchBatches(searchQuery, statusFilter);
        } else {
            toast.error("Failed to delete batch", { description: res.message });
        }
    };

    const statusBadge = (status: string) => {
        const s = status.toLowerCase();
        if (s === "active") return "bg-indigo-50 text-indigo-700";
        if (s === "completed") return "bg-emerald-50 text-emerald-700";
        return "bg-amber-50 text-amber-700";
    };

    const kindBadge = (kind: BatchItem["kind"]) => {
        if (kind === "FREE_SYSTEM") {
            return "bg-emerald-50 text-emerald-700";
        }
        return "bg-slate-100 text-slate-700";
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b pb-6 gap-4" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Batch Management</h1>
                    <p className="text-slate-500 mt-1">Create and assign students to their respective study batches.</p>
                </div>
                <Sheet open={createSheetOpen} onOpenChange={setCreateSheetOpen}>
                    <SheetTrigger asChild>
                        <Button className="bg-primary hover:bg-primary/90 rounded-xl px-6 h-12 shadow-clay-inner text-white font-bold text-base">
                            <Plus className="h-5 w-5 mr-2" />
                            Create New Batch
                        </Button>
                    </SheetTrigger>
                    <SheetContent className="border-l-0 shadow-clay-outer p-0 sm:max-w-md w-full flex flex-col">
                        <div className="p-6 border-b" style={{ borderColor: 'var(--border-soft)' }}>
                            <SheetHeader>
                                <SheetTitle className="font-serif text-2xl text-slate-900">Create New Batch</SheetTitle>
                                <SheetDescription>Add a new batch to assign tests and students to.</SheetDescription>
                            </SheetHeader>
                        </div>
                        <form onSubmit={handleCreateBatch} className="flex flex-col flex-1">
                            <div className="p-6 flex-1 overflow-auto grid gap-6 content-start text-left">
                                <div className="grid gap-2">
                                    <Label className="font-bold text-slate-700">Batch Name</Label>
                                    <Input name="batch-name" placeholder="e.g. Physics 101 Evening" required className="rounded-xl h-11 bg-surface-2 border-transparent" />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="font-bold text-slate-700">Batch Code</Label>
                                    <Input name="batch-code" placeholder="e.g. PHY-101-E (uppercase)" required className="rounded-xl h-11 bg-surface-2 border-transparent" />
                                </div>
                                <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                                    New batches are standard paid batches. The protected free-mock system batch is managed automatically.
                                </p>
                            </div>
                            <div className="p-6 border-t bg-surface-2 flex gap-2 justify-end" style={{ borderColor: 'var(--border-soft)' }}>
                                <SheetClose asChild>
                                    <Button type="button" variant="outline" className="rounded-xl h-12 border-transparent shadow-sm bg-white">Cancel</Button>
                                </SheetClose>
                                <Button type="submit" disabled={creating} className="rounded-xl h-12 bg-primary text-white font-bold shadow-clay-inner">
                                    {creating ? "Creating..." : "Create Batch"}
                                </Button>
                            </div>
                        </form>
                    </SheetContent>
                </Sheet>
            </div>

            <Card className="bg-card border-0 rounded-3xl overflow-hidden shadow-sm" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                <CardHeader className="p-6 border-b bg-surface-2 flex flex-col md:flex-row gap-4 items-center justify-between" style={{ borderColor: 'var(--border-soft)' }}>
                    <div className="w-full md:w-1/3 relative">
                        <Search className="h-5 w-5 absolute left-3 top-3 text-slate-400" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search batches by name or code..."
                            className="pl-10 h-11 bg-white border-transparent shadow-sm rounded-xl font-medium focus-visible:ring-primary"
                        />
                    </div>
                    <div className="w-full md:w-auto flex gap-3">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-full md:w-[160px] h-11 bg-white border-transparent shadow-sm rounded-xl font-medium">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-slate-200">
                                <SelectItem value="all">All Statuses</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="upcoming">Upcoming</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-surface border-b text-slate-600 font-serif" style={{ borderColor: 'var(--border-soft)' }}>
                            <tr>
                                <th className="px-6 py-4 font-bold text-slate-800">Batch Name</th>
                                <th className="px-6 py-4 font-bold text-slate-800">Batch Code</th>
                                <th className="px-6 py-4 font-bold text-slate-800">Batch Type</th>
                                <th className="px-6 py-4 font-bold text-slate-800 text-center">Students</th>
                                <th className="px-6 py-4 font-bold text-slate-800">Status</th>
                                <th className="px-6 py-4 font-bold text-slate-800 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {isLoading ? (
                                [1, 2, 3, 4].map((i) => (
                                    <tr key={`skeleton-${i}`}>
                                        <td className="px-6 py-5"><Skeleton className="h-5 w-40 rounded-md" /></td>
                                        <td className="px-6 py-5"><Skeleton className="h-4 w-24 rounded-md" /></td>
                                        <td className="px-6 py-5"><Skeleton className="h-4 w-32 rounded-md" /></td>
                                        <td className="px-6 py-5 text-center"><Skeleton className="h-6 w-16 mx-auto rounded-xl" /></td>
                                        <td className="px-6 py-5"><Skeleton className="h-5 w-20 rounded-full" /></td>
                                        <td className="px-6 py-5 text-right"><Skeleton className="h-8 w-16 ml-auto rounded-xl" /></td>
                                    </tr>
                                ))
                            ) : batches.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                        No batches found. Create your first batch above.
                                    </td>
                                </tr>
                            ) : (
                                batches.map((batch) => (
                                    <tr key={batch.id} className="hover:bg-surface/30 transition-colors group">
                                        <td className="px-6 py-5 font-bold text-slate-900 font-serif group-hover:text-primary transition-colors">
                                            <Link href={`/admin/batches/${batch.id}`} className="hover:underline">
                                                {batch.name}
                                            </Link>
                                        </td>
                                        <td className="px-6 py-5 font-mono text-xs text-slate-500 font-medium tracking-wide">
                                            {batch.code}
                                        </td>
                                        <td className="px-6 py-5">
                                            <Badge variant="outline" className={`border-none font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 ${kindBadge(batch.kind)}`}>
                                                {batch.kind === "FREE_SYSTEM" ? "Free System" : "Paid Batch"}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <div className="inline-flex items-center justify-center bg-slate-100 text-slate-800 font-bold px-3 py-1 rounded-xl shadow-inner gap-2">
                                                <Users className="h-3 w-3 text-slate-500" />
                                                {batch.studentCount}
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <Badge variant="outline" className={`border-none font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 ${statusBadge(batch.status)}`}>
                                                {batch.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-5 text-right flex justify-end">
                                            <Link href={`/admin/batches/${batch.id}`}>
                                                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-primary hover:bg-surface-2 rounded-xl">
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </Link>
                                            {batch.kind === "FREE_SYSTEM" ? null : (
                                                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ id: batch.id, name: batch.name })} className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl ml-1">
                                                    <Trash className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t bg-surface-2 text-center text-xs text-slate-500 font-medium" style={{ borderColor: 'var(--border-soft)' }}>
                    Showing {batches.length} of {total} batches
                </div>
            </Card>

            <DeleteConfirmDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                itemName={deleteTarget?.name || ""}
                itemType="batch"
                onDisable={handleDisableBatch}
                onPermanentDelete={handlePermanentDelete}
                disableLabel="Mark as Completed"
            />
        </div>
    );
}
