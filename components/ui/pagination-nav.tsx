"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildPaginationItems, getPaginationSummary } from "@/lib/utils/pagination";

type PaginationNavProps = {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    itemLabel: string;
    isLoading?: boolean;
    onPageChange: (page: number) => void;
};

export function PaginationNav({
    page,
    pageSize,
    totalItems,
    totalPages,
    itemLabel,
    isLoading = false,
    onPageChange,
}: PaginationNavProps) {
    const safeTotalPages = Math.max(totalPages, 1);
    const summary = getPaginationSummary(page, pageSize, totalItems);
    const pages = buildPaginationItems(page, safeTotalPages);

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-500">
                {totalItems === 0
                    ? `Showing 0 ${itemLabel}`
                    : `Showing ${summary.start}-${summary.end} of ${totalItems} ${itemLabel}`}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={page <= 1 || isLoading}
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                </Button>

                {pages.map((item, index) => {
                    if (item === 'ellipsis') {
                        return (
                            <div
                                key={`ellipsis-${index}`}
                                className="flex h-8 w-8 items-center justify-center text-slate-400"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </div>
                        );
                    }

                    const isActive = item === page;

                    return (
                        <Button
                            key={item}
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            className="min-w-8 rounded-xl px-3 font-semibold"
                            disabled={isLoading}
                            onClick={() => onPageChange(item)}
                        >
                            {item}
                        </Button>
                    );
                })}

                <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={page >= safeTotalPages || isLoading}
                    onClick={() => onPageChange(Math.min(safeTotalPages, page + 1))}
                >
                    Next
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
