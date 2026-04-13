"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseSharedContext } from "@/lib/utils/shared-context";

type SharedContextRendererProps = {
    context: string;
    title?: string;
    tone?: "indigo" | "emerald" | "slate";
};

const TONE_STYLES = {
    indigo: {
        container: "border-indigo-100 bg-indigo-50/70",
        label: "text-indigo-700",
        text: "text-slate-700",
        tableWrap: "border-indigo-100 bg-white/80",
        section: "border-indigo-100 bg-white/60",
        sectionTitle: "text-indigo-800",
    },
    emerald: {
        container: "border-emerald-100 bg-emerald-50/70",
        label: "text-emerald-700",
        text: "text-slate-700",
        tableWrap: "border-emerald-100 bg-white/80",
        section: "border-emerald-100 bg-white/60",
        sectionTitle: "text-emerald-800",
    },
    slate: {
        container: "border-slate-200 bg-slate-50/90",
        label: "text-slate-700",
        text: "text-slate-700",
        tableWrap: "border-slate-200 bg-white",
        section: "border-slate-200 bg-white",
        sectionTitle: "text-slate-800",
    },
} as const;

export function SharedContextRenderer({
    context,
    title = "Shared Reference",
    tone = "indigo",
}: SharedContextRendererProps) {
    const blocks = parseSharedContext(context);
    const styles = TONE_STYLES[tone];

    if (blocks.length === 0) {
        return null;
    }

    return (
        <div className={`rounded-[24px] border px-5 py-4 ${styles.container}`}>
            <div className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] ${styles.label}`}>
                {title}
            </div>

            <div className="space-y-4">
                {blocks.map((block, blockIndex) => {
                    if (block.type === "paragraph") {
                        return (
                            <div
                                key={`paragraph-${blockIndex}`}
                                className={`whitespace-pre-line text-sm leading-7 ${styles.text}`}
                            >
                                {block.text}
                            </div>
                        );
                    }

                    if (block.type === "preformatted") {
                        return (
                            <div
                                key={`preformatted-${blockIndex}`}
                                className={`overflow-x-auto rounded-[20px] border ${styles.tableWrap}`}
                            >
                                <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-6 text-slate-700">
                                    {block.text}
                                </pre>
                            </div>
                        );
                    }

                    if (block.type === "table") {
                        const rows = block.rows;
                        const header = block.hasHeader ? rows[0] : null;
                        const bodyRows = block.hasHeader ? rows.slice(1) : rows;

                        return (
                            <div
                                key={`table-${blockIndex}`}
                                className={`overflow-hidden rounded-[20px] border ${styles.tableWrap}`}
                            >
                                <Table className="text-sm">
                                    {header ? (
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent">
                                                {header.map((cell, cellIndex) => (
                                                    <TableHead
                                                        key={`header-${cellIndex}`}
                                                        className="h-auto whitespace-normal px-3 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
                                                    >
                                                        {cell}
                                                    </TableHead>
                                                ))}
                                            </TableRow>
                                        </TableHeader>
                                    ) : null}
                                    <TableBody>
                                        {bodyRows.map((row, rowIndex) => (
                                            <TableRow key={`row-${rowIndex}`} className="hover:bg-transparent">
                                                {row.map((cell, cellIndex) => (
                                                    <TableCell
                                                        key={`cell-${rowIndex}-${cellIndex}`}
                                                        className={`whitespace-normal px-3 py-3 text-sm ${
                                                            cellIndex === 0 ? "font-semibold text-slate-800" : "text-slate-700"
                                                        }`}
                                                    >
                                                        {cell}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        );
                    }

                    return (
                        <div
                            key={`paired-list-${blockIndex}`}
                            className={`grid gap-4 ${
                                block.sections.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"
                            }`}
                        >
                            {block.sections.map((section) => (
                                <div
                                    key={section.title}
                                    className={`rounded-[20px] border p-4 ${styles.section}`}
                                >
                                    <div className={`mb-3 text-xs font-semibold uppercase tracking-[0.22em] ${styles.sectionTitle}`}>
                                        {section.title}
                                    </div>
                                    <div className="space-y-2">
                                        {section.items.map((item) => (
                                            <div key={`${section.title}-${item.label}`} className="flex gap-3 text-sm leading-6 text-slate-700">
                                                <div className="min-w-6 font-semibold uppercase text-slate-500">
                                                    {item.label}
                                                </div>
                                                <div>{item.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
