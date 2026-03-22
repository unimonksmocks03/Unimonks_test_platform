"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useState } from "react";
import { Search, Inbox, CheckCircle2 } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LeadQueueItem = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    createdAt: string;
    isReviewed: boolean;
    reviewedAt: string | null;
    sourceTest: {
        id: string;
        title: string;
    } | null;
    latestSession: {
        id: string;
        status: "IN_PROGRESS" | "SUBMITTED" | "TIMED_OUT" | "FORCE_SUBMITTED";
        score: number | null;
        totalMarks: number;
        percentage: number | null;
        startedAt: string;
        submittedAt: string | null;
    } | null;
};

type LeadQueueResponse = {
    leads: LeadQueueItem[];
    total: number;
    page: number;
    totalPages: number;
};

type LeadSessionSummary = NonNullable<LeadQueueItem["latestSession"]>;

const REVIEW_FILTERS = [
    { value: "all", label: "All Leads" },
    { value: "unreviewed", label: "Unreviewed" },
    { value: "reviewed", label: "Reviewed" },
] as const;

function formatSessionStatus(status: LeadSessionSummary["status"]) {
    if (status === "SUBMITTED") return "Submitted";
    if (status === "FORCE_SUBMITTED") return "Force Submitted";
    if (status === "TIMED_OUT") return "Timed Out";
    return "In Progress";
}

function reviewBadgeClass(isReviewed: boolean) {
    return isReviewed
        ? "bg-emerald-50 text-emerald-700 border-none"
        : "bg-amber-50 text-amber-700 border-none";
}

export default function AdminLeadsPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [leads, setLeads] = useState<LeadQueueItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState("");
    const deferredSearch = useDeferredValue(search);
    const [reviewedFilter, setReviewedFilter] = useState<(typeof REVIEW_FILTERS)[number]["value"]>("all");
    const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);

    const fetchLeads = useCallback(async (filters?: {
        search?: string;
        reviewed?: string;
        page?: number;
    }) => {
        return apiClient.get<LeadQueueResponse>("/api/admin/leads", {
            search: filters?.search || undefined,
            reviewed: filters?.reviewed || undefined,
            page: filters?.page || 1,
            limit: 25,
        });
    }, []);

    useEffect(() => {
        let isCancelled = false;

        const loadLeads = async () => {
            const response = await fetchLeads({
                search: deferredSearch.trim() || undefined,
                reviewed: reviewedFilter,
                page,
            });

            if (isCancelled) {
                return;
            }

            if (response.ok) {
                startTransition(() => {
                    setLeads(response.data.leads);
                    setTotal(response.data.total);
                    setTotalPages(response.data.totalPages);
                });
            } else {
                toast.error("Failed to load leads", { description: response.message });
            }

            setIsLoading(false);
            setIsRefreshing(false);
        };

        void loadLeads();

        return () => {
            isCancelled = true;
        };
    }, [deferredSearch, fetchLeads, page, reviewedFilter]);

    const handleReviewToggle = async (leadId: string, isReviewed: boolean) => {
        setUpdatingLeadId(leadId);

        const response = await apiClient.patch<{ lead: { id: string; isReviewed: boolean; reviewedAt: string | null } }>(
            `/api/admin/leads/${leadId}`,
            { isReviewed },
        );

        if (!response.ok) {
            toast.error("Failed to update lead", { description: response.message });
            setUpdatingLeadId(null);
            return;
        }

        // Keep the updated lead visible in the current table instead of immediately
        // refetching and letting the active reviewed filter remove it from view.
        startTransition(() => {
            setLeads((currentLeads) =>
                currentLeads.map((lead) =>
                    lead.id === response.data.lead.id
                        ? {
                            ...lead,
                            isReviewed: response.data.lead.isReviewed,
                            reviewedAt: response.data.lead.reviewedAt,
                        }
                        : lead,
                ),
            );
        });

        toast.success(isReviewed ? "Lead marked as reviewed" : "Lead moved back to unreviewed");

        setUpdatingLeadId(null);
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div
                className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: "var(--border-soft)" }}
            >
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Lead Queue</h1>
                    <p className="mt-1 text-slate-500">
                        Actionable free-mock leads, with already-enrolled student emails hidden automatically.
                    </p>
                </div>
                <Badge variant="outline" className="w-fit rounded-xl px-4 py-2 text-sm font-bold">
                    {total} visible leads
                </Badge>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                        value={search}
                        onChange={(event) => {
                            setIsRefreshing(true);
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                        placeholder="Search leads by name, email, or phone..."
                        className="h-12 rounded-xl border-transparent bg-surface-2 pl-10 font-medium"
                    />
                </div>
                <Select
                    value={reviewedFilter}
                    onValueChange={(value) => {
                        setIsRefreshing(true);
                        setReviewedFilter(value as typeof reviewedFilter);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="h-12 rounded-xl border-transparent bg-surface-2 font-semibold">
                        <SelectValue placeholder="Review status" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-slate-200">
                        {REVIEW_FILTERS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <Card className="overflow-hidden rounded-3xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                <CardHeader className="border-b bg-slate-50/80 p-6" style={{ borderColor: "var(--border-soft)" }}>
                    <CardTitle className="flex items-center gap-2 font-serif text-xl text-slate-900">
                        <Inbox className="h-5 w-5 text-indigo-500" />
                        Actionable Leads
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/40">
                            <TableRow>
                                <TableHead className="pl-6 font-semibold text-slate-700">Lead</TableHead>
                                <TableHead className="font-semibold text-slate-700">Contact</TableHead>
                                <TableHead className="font-semibold text-slate-700">Source Test</TableHead>
                                <TableHead className="font-semibold text-slate-700">Session Summary</TableHead>
                                <TableHead className="font-semibold text-slate-700">Captured</TableHead>
                                <TableHead className="pr-6 text-center font-semibold text-slate-700">Reviewed</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [1, 2, 3, 4, 5].map((row) => (
                                    <TableRow key={`lead-skeleton-${row}`}>
                                        <TableCell className="pl-6"><Skeleton className="h-5 w-32 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-10 w-40 rounded-xl" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-32 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-10 w-48 rounded-xl" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24 rounded-md" /></TableCell>
                                        <TableCell className="pr-6 text-center"><Skeleton className="mx-auto h-4 w-4 rounded-sm" /></TableCell>
                                    </TableRow>
                                ))
                            ) : leads.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-16 text-center text-slate-400">
                                        No visible leads match the current filters.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                leads.map((lead) => (
                                    <TableRow key={lead.id}>
                                        <TableCell className="pl-6">
                                            <div className="flex flex-col gap-2">
                                                <span className="font-medium text-slate-900">{lead.name}</span>
                                                <Badge
                                                    variant="secondary"
                                                    className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${reviewBadgeClass(lead.isReviewed)}`}
                                                >
                                                    {lead.isReviewed ? "Reviewed" : "Unreviewed"}
                                                </Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-600">
                                            <div className="flex flex-col gap-1">
                                                <span>{lead.email || "No email provided"}</span>
                                                <span className="text-slate-400">{lead.phone || "No phone provided"}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-600">
                                            {lead.sourceTest ? (
                                                <span className="font-medium text-slate-700">{lead.sourceTest.title}</span>
                                            ) : (
                                                <span className="text-slate-400">No source test</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-600">
                                            {lead.latestSession ? (
                                                <div className="flex flex-col gap-1">
                                                    <span className="font-medium text-slate-800">
                                                        {formatSessionStatus(lead.latestSession.status)}
                                                    </span>
                                                    {lead.latestSession.percentage !== null ? (
                                                        <span>
                                                            {Math.round(lead.latestSession.percentage)}% ({lead.latestSession.score ?? 0}/{lead.latestSession.totalMarks})
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400">Score pending</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-slate-400">No free-test session yet</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-500">
                                            {new Date(lead.createdAt).toLocaleString()}
                                        </TableCell>
                                        <TableCell className="pr-6">
                                            <div className="flex flex-col items-center gap-2">
                                                <Checkbox
                                                    checked={lead.isReviewed}
                                                    disabled={updatingLeadId === lead.id || isRefreshing}
                                                    onCheckedChange={(checked) => void handleReviewToggle(lead.id, checked === true)}
                                                    className="border-slate-300 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
                                                />
                                                {lead.reviewedAt && (
                                                    <span className="text-[11px] font-medium text-slate-400">
                                                        {new Date(lead.reviewedAt).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                    Showing page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={page <= 1 || isRefreshing}
                        onClick={() => {
                            setIsRefreshing(true);
                            setPage((current) => Math.max(1, current - 1));
                        }}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={page >= totalPages || isRefreshing}
                        onClick={() => {
                            setIsRefreshing(true);
                            setPage((current) => Math.min(totalPages, current + 1));
                        }}
                    >
                        Next
                    </Button>
                </div>
            </div>

            <Card className="rounded-3xl border border-emerald-100 bg-emerald-50/60">
                <CardContent className="flex items-start gap-3 p-5 text-sm text-emerald-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>
                        Leads are filtered server-side so any normalized email already matching a registered student never enters this queue.
                    </span>
                </CardContent>
            </Card>
        </div>
    );
}
