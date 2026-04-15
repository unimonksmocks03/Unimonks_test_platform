"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, Trash2 } from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Input } from "@/components/ui/input";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { matchesTestSearch } from "@/lib/utils/test-search";

type AssignedBatch = {
    id: string;
    name: string;
    code: string;
    kind: "FREE_SYSTEM" | "STANDARD";
};

type AdminTestItem = {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    source: "MANUAL" | "AI_GENERATED";
    audience: "FREE" | "PAID" | "HYBRID" | "UNASSIGNED";
    questionCount: number;
    attemptCount: number;
    assignmentCount: number;
    assignedBatches: AssignedBatch[];
    createdAt: string;
    updatedAt: string;
};

type AdminTestsResponse = {
    tests: AdminTestItem[];
    total: number;
    page: number;
    totalPages: number;
};

const STATUS_FILTERS = [
    { value: "ALL", label: "All statuses" },
    { value: "DRAFT", label: "Draft" },
    { value: "PUBLISHED", label: "Published" },
    { value: "ARCHIVED", label: "Archived" },
] as const;

const PAGE_SIZE = 20;

function resolveStatusFilter(value: string | null) {
    if (value && STATUS_FILTERS.some((option) => option.value === value)) {
        return value as (typeof STATUS_FILTERS)[number]["value"];
    }

    return "ALL";
}

function resolvePage(value: string | null) {
    const parsed = Number.parseInt(value || "1", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function statusBadgeClass(status: AdminTestItem["status"]) {
    if (status === "PUBLISHED") return "bg-emerald-50 text-emerald-700 border-none";
    if (status === "DRAFT") return "bg-amber-50 text-amber-700 border-none";
    return "bg-slate-100 text-slate-600 border-none";
}

function audienceBadgeClass(audience: AdminTestItem["audience"]) {
    if (audience === "FREE") return "bg-sky-50 text-sky-700 border-none";
    if (audience === "PAID") return "bg-violet-50 text-violet-700 border-none";
    if (audience === "HYBRID") return "bg-emerald-50 text-emerald-700 border-none";
    return "bg-slate-100 text-slate-600 border-none";
}

function audienceLabel(audience: AdminTestItem["audience"]) {
    if (audience === "UNASSIGNED") return "Unassigned";
    if (audience === "HYBRID") return "Free + Paid";
    return audience;
}

export default function AdminTestsPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const urlSearch = useMemo(() => searchParams.get("search") || "", [searchParams]);
    const urlStatus = useMemo(() => resolveStatusFilter(searchParams.get("status")), [searchParams]);
    const urlPage = useMemo(() => resolvePage(searchParams.get("page")), [searchParams]);

    const [isLoading, setIsLoading] = useState(true);
    const [tests, setTests] = useState<AdminTestItem[]>([]);
    const [searchIndexTests, setSearchIndexTests] = useState<AdminTestItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(urlPage);
    const [livePage, setLivePage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [search, setSearch] = useState(urlSearch);
    const [appliedSearch, setAppliedSearch] = useState(urlSearch);
    const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["value"]>(urlStatus);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

    const isSearchDirty = search.trim() !== appliedSearch.trim();

    const syncQueryState = useCallback((next: {
        search: string;
        status: (typeof STATUS_FILTERS)[number]["value"];
        page: number;
    }) => {
        const params = new URLSearchParams(searchParams.toString());

        if (next.search) {
            params.set("search", next.search);
        } else {
            params.delete("search");
        }

        if (next.status !== "ALL") {
            params.set("status", next.status);
        } else {
            params.delete("status");
        }

        if (next.page > 1) {
            params.set("page", String(next.page));
        } else {
            params.delete("page");
        }

        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    const fetchTests = useCallback(async (filters?: { search?: string; status?: string; page?: number }) => {
        setIsLoading(true);
        const response = await apiClient.get<AdminTestsResponse>("/api/admin/tests", {
            search: filters?.search || undefined,
            status: filters?.status || undefined,
            page: filters?.page || 1,
            limit: PAGE_SIZE,
        });

        if (response.ok) {
            const nextTotalPages = Math.max(1, response.data.totalPages);
            if (filters?.page && filters.page > nextTotalPages) {
                setTotalPages(nextTotalPages);
                setPage(nextTotalPages);
                syncQueryState({
                    search: filters.search || "",
                    status: (filters.status as (typeof STATUS_FILTERS)[number]["value"]) || "ALL",
                    page: nextTotalPages,
                });
                setIsLoading(false);
                return;
            }
            startTransition(() => {
                setTests(response.data.tests);
                setTotal(response.data.total);
                setTotalPages(nextTotalPages);
            });
        } else {
            toast.error("Failed to load tests", { description: response.message });
        }

        setIsLoading(false);
    }, [syncQueryState]);

    const fetchSearchIndex = useCallback(async (status?: string) => {
        const collected: AdminTestItem[] = [];
        let nextPage = 1;
        let pages = 1;

        do {
            const response = await apiClient.get<AdminTestsResponse>("/api/admin/tests", {
                status: status || undefined,
                page: nextPage,
                limit: 100,
            });

            if (!response.ok) {
                toast.error("Failed to build instant test search", { description: response.message });
                return;
            }

            collected.push(...response.data.tests);
            pages = response.data.totalPages;
            nextPage += 1;
        } while (nextPage <= pages);

        setSearchIndexTests(collected);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local form and pagination state from URL parameters for back/forward navigation
        setSearch(urlSearch);
        setAppliedSearch(urlSearch);
        setStatusFilter(urlStatus);
        setPage(urlPage);
    }, [urlPage, urlSearch, urlStatus]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional data refetch when filters change
        void fetchTests({
            search: appliedSearch.trim() || undefined,
            status: statusFilter === "ALL" ? undefined : statusFilter,
            page,
        });
    }, [appliedSearch, fetchTests, page, statusFilter]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- async index refresh populates local instant-search cache for the chosen status
        void fetchSearchIndex(statusFilter === "ALL" ? undefined : statusFilter);
    }, [fetchSearchIndex, statusFilter]);

    const liveMatches = useMemo(() => {
        const query = search.trim();
        const source = searchIndexTests.length > 0 ? searchIndexTests : tests;

        if (!query) {
            return source;
        }

        return source.filter((test) => matchesTestSearch(test.title, query));
    }, [search, searchIndexTests, tests]);

    const visibleTests = useMemo(() => {
        if (!isSearchDirty) {
            return tests;
        }

        const start = (livePage - 1) * PAGE_SIZE;
        return liveMatches.slice(start, start + PAGE_SIZE);
    }, [isSearchDirty, liveMatches, livePage, tests]);

    const displayPage = isSearchDirty ? livePage : page;
    const displayTotal = isSearchDirty ? liveMatches.length : total;
    const displayTotalPages = isSearchDirty ? Math.max(1, Math.ceil(liveMatches.length / PAGE_SIZE)) : totalPages;
    const resultsBadgeLabel = isSearchDirty ? `${displayTotal} matches` : `${total} tests`;

    const handlePermanentDelete = async () => {
        if (!deleteTarget) return;

        const response = await apiClient.delete<{ message: string }>(`/api/admin/tests/${deleteTarget.id}`);
        if (!response.ok) {
            toast.error("Failed to delete test", { description: response.message });
            return;
        }

        toast.success("Test deleted", { description: response.data.message });
        setDeleteTarget(null);

        void fetchTests({
            search: appliedSearch.trim() || undefined,
            status: statusFilter === "ALL" ? undefined : statusFilter,
            page,
        });
    };

    const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const nextSearch = search.trim();

        setAppliedSearch(nextSearch);
        setPage(1);
        syncQueryState({
            search: nextSearch,
            status: statusFilter,
            page: 1,
        });
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div
                className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: "var(--border-soft)" }}
            >
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">Test Management</h1>
                    <p className="mt-1 text-slate-500">
                        Create, edit, assign, and publish admin-owned mock tests.
                    </p>
                </div>
                <Link href="/admin/tests/create">
                    <Button className="h-12 rounded-xl px-6 text-base font-bold shadow-clay-inner">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Test
                    </Button>
                </Link>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                    <form onSubmit={handleSearchSubmit} className="flex flex-1 gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={search}
                                onChange={(event) => {
                                    setSearch(event.target.value);
                                    setLivePage(1);
                                }}
                                placeholder="Search tests by title..."
                                className="h-12 rounded-xl border-transparent bg-surface-2 pl-10 font-medium"
                            />
                        </div>
                        <Button type="submit" variant="outline" className="h-12 rounded-xl px-5 font-semibold">
                            Enter
                        </Button>
                    </form>
                    <Select
                        value={statusFilter}
                        onValueChange={(value) => {
                            setStatusFilter(value as typeof statusFilter);
                            setPage(1);
                            setLivePage(1);
                            syncQueryState({
                                search: appliedSearch,
                                status: value as (typeof STATUS_FILTERS)[number]["value"],
                                page: 1,
                            });
                        }}
                    >
                        <SelectTrigger className="h-12 w-full rounded-xl border-transparent bg-surface-2 font-semibold sm:w-[190px]">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-200">
                            {STATUS_FILTERS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Badge variant="outline" className="w-fit rounded-xl px-4 py-2 text-sm font-bold">
                    {resultsBadgeLabel}
                </Badge>
            </div>

            {isSearchDirty ? (
                <p className="text-sm font-medium text-slate-500">
                    Instant search is matching across all tests in the current status. Press Enter to apply the filter server-side and keep it in your workflow.
                </p>
            ) : null}

            <Card className="overflow-hidden rounded-3xl border-0 bg-white" style={{ boxShadow: "var(--shadow-clay-outer)" }}>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/80">
                            <TableRow>
                                <TableHead className="pl-6 font-semibold text-slate-700">Test</TableHead>
                                <TableHead className="font-semibold text-slate-700">Audience</TableHead>
                                <TableHead className="font-semibold text-slate-700">Assignments</TableHead>
                                <TableHead className="font-semibold text-slate-700">Duration</TableHead>
                                <TableHead className="font-semibold text-slate-700">Questions</TableHead>
                                <TableHead className="font-semibold text-slate-700">Status</TableHead>
                                <TableHead className="text-center font-semibold text-slate-700">Attempts</TableHead>
                                <TableHead className="pr-6 text-right font-semibold text-slate-700">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [1, 2, 3, 4].map((row) => (
                                    <TableRow key={`admin-test-skeleton-${row}`}>
                                        <TableCell className="pl-6">
                                            <div className="space-y-2">
                                                <Skeleton className="h-5 w-40 rounded-md" />
                                                <Skeleton className="h-4 w-24 rounded-md" />
                                            </div>
                                        </TableCell>
                                        <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                                        <TableCell><Skeleton className="h-10 w-44 rounded-xl" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-8 rounded-md" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                                        <TableCell className="text-center"><Skeleton className="mx-auto h-4 w-8 rounded-md" /></TableCell>
                                        <TableCell className="pr-6 text-right">
                                            <div className="flex justify-end gap-2">
                                                <Skeleton className="h-8 w-16 rounded-lg" />
                                                <Skeleton className="h-8 w-9 rounded-lg" />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : visibleTests.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="py-12 text-center text-slate-400">
                                        {isSearchDirty
                                            ? "No tests match this instant search. Press Enter to apply the filter server-side."
                                            : "No tests found for the current filters."}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                visibleTests.map((test) => (
                                    <TableRow key={test.id} className="group">
                                        <TableCell className="pl-6">
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-slate-900">{test.title}</span>
                                                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                                                    <span>{test.source === "AI_GENERATED" ? "AI generated" : "Manual"}</span>
                                                    <span>•</span>
                                                    <span>Updated {new Date(test.updatedAt).toLocaleDateString()}</span>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="secondary"
                                                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${audienceBadgeClass(test.audience)}`}
                                            >
                                                {audienceLabel(test.audience)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm text-slate-600">
                                            {test.assignedBatches.length === 0 ? (
                                                <span className="text-slate-400">No batches assigned</span>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    {test.assignedBatches.slice(0, 2).map((batch) => (
                                                        <span key={batch.id} className="font-medium text-slate-700">
                                                            {batch.name} <span className="text-slate-400">({batch.code})</span>
                                                        </span>
                                                    ))}
                                                    {test.assignedBatches.length > 2 && (
                                                        <span className="text-xs font-medium text-slate-500">
                                                            +{test.assignedBatches.length - 2} more batch{test.assignedBatches.length > 3 ? "es" : ""}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-slate-600">{test.durationMinutes} min</TableCell>
                                        <TableCell className="font-bold text-slate-700">{test.questionCount}</TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="secondary"
                                                className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(test.status)}`}
                                            >
                                                {test.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-center font-bold text-slate-700">{test.attemptCount}</TableCell>
                                        <TableCell className="pr-6 text-right">
                                            <div className="flex justify-end gap-2">
                                                <Link href={`/admin/tests/create?edit=${test.id}`}>
                                                    <Button variant="outline" size="sm" className="h-8 rounded-lg shadow-sm">
                                                        {test.status === "DRAFT" ? "Edit Draft" : "View"}
                                                    </Button>
                                                </Link>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 rounded-lg px-2 text-red-500 hover:bg-red-50 hover:text-red-700"
                                                    onClick={() => setDeleteTarget({ id: test.id, title: test.title })}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <PaginationNav
                page={displayPage}
                pageSize={PAGE_SIZE}
                totalItems={displayTotal}
                totalPages={displayTotalPages}
                itemLabel="tests"
                isLoading={isLoading}
                onPageChange={(nextPage) => {
                    if (isSearchDirty) {
                        setLivePage(nextPage);
                        return;
                    }

                    setPage(nextPage);
                    syncQueryState({
                        search: appliedSearch,
                        status: statusFilter,
                        page: nextPage,
                    });
                }}
            />

            <DeleteConfirmDialog
                open={!!deleteTarget}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
                itemName={deleteTarget?.title || ""}
                itemType="test"
                showDisableOption={false}
                onPermanentDelete={handlePermanentDelete}
            />
        </div>
    );
}
