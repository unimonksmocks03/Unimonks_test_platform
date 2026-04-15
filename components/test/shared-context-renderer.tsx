"use client";

import Image from 'next/image'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { QuestionReferencePayload } from "@/lib/types/question-reference";
import { isVisualReference } from "@/lib/utils/question-reference-selection";
import { parseSharedContext } from "@/lib/utils/shared-context";

type SharedContextRendererProps = {
    context?: string | null;
    references?: QuestionReferencePayload[] | null;
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

function normalizeComparableText(value: string) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isGenericReferenceTitle(title: string | null | undefined) {
    const normalized = title?.trim().toLowerCase();
    if (!normalized) return true;
    return (
        normalized === "manual visual reference"
        || normalized === "visual reference"
        || /^reference(?:\s+\d+)?$/.test(normalized)
        || /^(diagram|graph|map|table|passage|other)\s+\d+$/.test(normalized)
    );
}

function getReferenceTitle(reference: QuestionReferencePayload) {
    const nextTitle = reference.title?.trim() || null;
    return isGenericReferenceTitle(nextTitle) ? null : nextTitle;
}

function renderParsedBlocks(
    text: string,
    styles: (typeof TONE_STYLES)[keyof typeof TONE_STYLES],
    keyPrefix: string,
) {
    const blocks = parseSharedContext(text);

    return blocks.map((block, blockIndex) => {
        if (block.type === "paragraph") {
            return (
                <div
                    key={`${keyPrefix}-paragraph-${blockIndex}`}
                    className={`whitespace-pre-line text-sm leading-7 ${styles.text}`}
                >
                    {block.text}
                </div>
            );
        }

        if (block.type === "preformatted") {
            return (
                <div
                    key={`${keyPrefix}-preformatted-${blockIndex}`}
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
                    key={`${keyPrefix}-table-${blockIndex}`}
                    className={`overflow-hidden rounded-[20px] border ${styles.tableWrap}`}
                >
                    <Table className="text-sm">
                        {header ? (
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    {header.map((cell, cellIndex) => (
                                        <TableHead
                                            key={`${keyPrefix}-header-${cellIndex}`}
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
                                <TableRow key={`${keyPrefix}-row-${rowIndex}`} className="hover:bg-transparent">
                                    {row.map((cell, cellIndex) => (
                                        <TableCell
                                            key={`${keyPrefix}-cell-${rowIndex}-${cellIndex}`}
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
                key={`${keyPrefix}-paired-list-${blockIndex}`}
                className={`grid gap-4 ${
                    block.sections.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"
                }`}
            >
                {block.sections.map((section) => (
                    <div
                        key={`${keyPrefix}-${section.title}`}
                        className={`rounded-[20px] border p-4 ${styles.section}`}
                    >
                        <div className={`mb-3 text-xs font-semibold uppercase tracking-[0.22em] ${styles.sectionTitle}`}>
                            {section.title}
                        </div>
                        <div className="space-y-2">
                            {section.items.map((item) => (
                                <div key={`${keyPrefix}-${section.title}-${item.label}`} className="flex gap-3 text-sm leading-6 text-slate-700">
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
    });
}

export function SharedContextRenderer({
    context,
    references,
    title = "Shared Reference",
    tone = "indigo",
}: SharedContextRendererProps) {
    const styles = TONE_STYLES[tone];
    const normalizedContext = context?.trim() || "";
    const normalizedReferences = [...(references ?? [])]
        .filter((reference) => reference.assetUrl || reference.textContent || reference.title)
        .sort((left, right) => left.order - right.order);
    const hasAnyVisualImage = normalizedReferences.some((reference) =>
        isVisualReference(reference) && Boolean(reference.assetUrl),
    );
    const hasRenderableReferences = normalizedReferences.length > 0;
    const renderedReferenceText = normalizedReferences
        .map((reference) => reference.textContent?.trim())
        .filter((value): value is string => Boolean(value))
        .join("\n\n");
    const shouldRenderFallbackContext = Boolean(
        normalizedContext &&
            (!hasRenderableReferences ||
                normalizeComparableText(normalizedContext) !== normalizeComparableText(renderedReferenceText)),
    );

    if (!hasRenderableReferences && !shouldRenderFallbackContext) {
        return null;
    }

    return (
        <div className={`rounded-[24px] border px-5 py-4 ${styles.container}`}>
            <div className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] ${styles.label}`}>
                {title}
            </div>

            <div className="space-y-4">
                {normalizedReferences.map((reference) => {
                    const hasImage = Boolean(reference.assetUrl);
                    const hasText = Boolean(reference.textContent?.trim());
                    const shouldShowImage = reference.mode !== "TEXT";
                    const shouldShowText = reference.mode !== "SNAPSHOT" || !hasImage;
                    const shouldShowMissingImagePlaceholder = shouldShowImage && !hasImage && !hasAnyVisualImage;
                    const referenceTitle = getReferenceTitle(reference);

                    return (
                        <div key={reference.id} className="space-y-3">
                            {referenceTitle ? (
                                <div className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${styles.sectionTitle}`}>
                                    {referenceTitle}
                                </div>
                            ) : null}

                            {shouldShowImage ? (
                                hasImage ? (
                                    <div className={`overflow-hidden rounded-[20px] border ${styles.tableWrap}`}>
                                        <Image
                                            src={reference.assetUrl as string}
                                            alt={reference.title || "Question reference snapshot"}
                                            width={1200}
                                            height={900}
                                            sizes="(max-width: 768px) 100vw, 720px"
                                            unoptimized
                                            className="h-auto max-h-[420px] w-full object-contain bg-white"
                                            loading="lazy"
                                        />
                                    </div>
                                ) : shouldShowMissingImagePlaceholder ? (
                                    <div className={`rounded-[20px] border border-dashed px-4 py-4 text-sm ${styles.text}`}>
                                        Snapshot reference is expected for this question, but no image asset is available yet.
                                    </div>
                                ) : null
                            ) : null}

                            {hasText && shouldShowText ? (
                                <div className="space-y-4">
                                    {renderParsedBlocks(reference.textContent as string, styles, `reference-${reference.id}`)}
                                </div>
                            ) : null}
                        </div>
                    );
                })}

                {shouldRenderFallbackContext ? (
                    <div className="space-y-3">
                        {hasRenderableReferences ? (
                            <div className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${styles.sectionTitle}`}>
                                Shared Context
                            </div>
                        ) : null}
                        <div className="space-y-4">
                            {renderParsedBlocks(normalizedContext, styles, "fallback")}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
