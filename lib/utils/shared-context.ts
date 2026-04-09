export type SharedContextParagraphBlock = {
    type: "paragraph";
    text: string;
};

export type SharedContextTableBlock = {
    type: "table";
    rows: string[][];
    hasHeader: boolean;
};

export type SharedContextListItem = {
    label: string;
    text: string;
};

export type SharedContextListSection = {
    title: string;
    items: SharedContextListItem[];
};

export type SharedContextListBlock = {
    type: "paired-list";
    sections: SharedContextListSection[];
};

export type SharedContextBlock =
    | SharedContextParagraphBlock
    | SharedContextTableBlock
    | SharedContextListBlock;

const BLANK_LINE = /^\s*$/;
const LIST_HEADER = /^(list|column)\s+([ivxlcdm]+|\d+|[a-z])\b[:.]?$/i;
const LIST_ITEM = /^\(?([a-z0-9]+)\)?[.)-]\s+(.+)$/i;
const NUMERICISH_TOKEN = /^-?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?%?$/;
const YEAR_TOKEN = /^(19|20)\d{2}$/;

function normalizeLine(line: string) {
    return line.replace(/\t/g, " ").replace(/\s+$/g, "");
}

function splitIntoLines(text: string) {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map(normalizeLine);
}

function tokenizeTableRow(line: string) {
    return line.trim().split(/\s+/).filter(Boolean);
}

function countNumericish(tokens: string[]) {
    return tokens.filter((token) => NUMERICISH_TOKEN.test(token) || YEAR_TOKEN.test(token)).length;
}

function looksLikeListHeader(line: string) {
    return LIST_HEADER.test(line.trim());
}

function normalizeListHeader(line: string) {
    return line.trim().replace(/[:.]$/, "");
}

function isLikelyTableStart(lines: string[], index: number) {
    const currentTokens = tokenizeTableRow(lines[index] || "");
    const nextTokens = tokenizeTableRow(lines[index + 1] || "");

    if (currentTokens.length < 3 || currentTokens.length > 10) {
        return false;
    }

    if (currentTokens.join(" ").length > 96) {
        return false;
    }

    if (currentTokens.length !== nextTokens.length || nextTokens.length < 3) {
        return false;
    }

    const nextNumericCount = countNumericish(nextTokens);
    const currentNumericCount = countNumericish(currentTokens);

    if (nextNumericCount < 2) {
        return false;
    }

    return currentNumericCount >= 1 || /[A-Za-z]/.test(currentTokens[0] || "");
}

function hasHeaderRow(rows: string[][]) {
    if (rows.length < 2) {
        return false;
    }

    const [firstRow, secondRow] = rows;
    const secondNumeric = countNumericish(secondRow);

    return (
        /[A-Za-z]/.test(firstRow[0] || "") &&
        !NUMERICISH_TOKEN.test(firstRow[0] || "") &&
        secondNumeric >= Math.max(2, secondRow.length - 2) &&
        firstRow.length === secondRow.length
    );
}

function parseTableBlock(lines: string[], start: number) {
    if (!isLikelyTableStart(lines, start)) {
        return null;
    }

    const expectedColumnCount = tokenizeTableRow(lines[start]).length;
    const rows: string[][] = [];
    let index = start;

    while (index < lines.length) {
        const line = lines[index];

        if (BLANK_LINE.test(line) || looksLikeListHeader(line)) {
            break;
        }

        const tokens = tokenizeTableRow(line);
        if (
            tokens.length !== expectedColumnCount ||
            tokens.length < 3 ||
            tokens.length > 10 ||
            line.length > 96
        ) {
            break;
        }

        rows.push(tokens);
        index += 1;
    }

    if (rows.length < 2) {
        return null;
    }

    const dataRows = rows.slice(1);
    const denseDataRows = dataRows.filter((row) => countNumericish(row) >= Math.max(2, row.length - 2)).length;
    if (denseDataRows < Math.max(1, Math.ceil(dataRows.length / 2))) {
        return null;
    }

    return {
        block: {
            type: "table" as const,
            rows,
            hasHeader: hasHeaderRow(rows),
        },
        nextIndex: index,
    };
}

function parsePairedListBlock(lines: string[], start: number) {
    if (!looksLikeListHeader(lines[start] || "")) {
        return null;
    }

    const sections: SharedContextListSection[] = [];
    let index = start;

    while (index < lines.length) {
        while (index < lines.length && BLANK_LINE.test(lines[index])) {
            index += 1;
        }

        if (!looksLikeListHeader(lines[index] || "")) {
            break;
        }

        const title = normalizeListHeader(lines[index]);
        index += 1;

        const items: SharedContextListItem[] = [];

        while (index < lines.length && !BLANK_LINE.test(lines[index]) && !looksLikeListHeader(lines[index])) {
            const line = lines[index].trim();
            const itemMatch = LIST_ITEM.exec(line);

            if (itemMatch) {
                items.push({
                    label: itemMatch[1],
                    text: itemMatch[2].trim(),
                });
            } else if (items.length > 0) {
                items[items.length - 1].text = `${items[items.length - 1].text} ${line}`.trim();
            } else {
                return null;
            }

            index += 1;
        }

        if (items.length === 0) {
            return null;
        }

        sections.push({ title, items });
    }

    if (sections.length < 2) {
        return null;
    }

    return {
        block: {
            type: "paired-list" as const,
            sections,
        },
        nextIndex: index,
    };
}

function flushParagraphs(buffer: string[], blocks: SharedContextBlock[]) {
    if (buffer.length === 0) {
        return;
    }

    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const line of buffer) {
        if (BLANK_LINE.test(line)) {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk.join("\n"));
                currentChunk = [];
            }
            continue;
        }

        currentChunk.push(line.trim());
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join("\n"));
    }

    for (const chunk of chunks) {
        if (chunk.trim()) {
            blocks.push({ type: "paragraph", text: chunk.trim() });
        }
    }

    buffer.length = 0;
}

export function parseSharedContext(text: string | null | undefined): SharedContextBlock[] {
    if (!text || !text.trim()) {
        return [];
    }

    const lines = splitIntoLines(text);
    const blocks: SharedContextBlock[] = [];
    const paragraphBuffer: string[] = [];

    for (let index = 0; index < lines.length;) {
        const line = lines[index];

        if (BLANK_LINE.test(line)) {
            paragraphBuffer.push(line);
            index += 1;
            continue;
        }

        const listBlock = parsePairedListBlock(lines, index);
        if (listBlock) {
            flushParagraphs(paragraphBuffer, blocks);
            blocks.push(listBlock.block);
            index = listBlock.nextIndex;
            continue;
        }

        const tableBlock = parseTableBlock(lines, index);
        if (tableBlock) {
            flushParagraphs(paragraphBuffer, blocks);
            blocks.push(tableBlock.block);
            index = tableBlock.nextIndex;
            continue;
        }

        paragraphBuffer.push(line);
        index += 1;
    }

    flushParagraphs(paragraphBuffer, blocks);

    if (blocks.length === 0) {
        return [{ type: "paragraph", text: text.trim() }];
    }

    return blocks;
}
