import { describe, expect, it } from "vitest";

import { parseSharedContext } from "@/lib/utils/shared-context";

describe("parseSharedContext", () => {
    it("extracts paragraph and rectangular table blocks", () => {
        const blocks = parseSharedContext(`
UNIT 12: DATA INTERPRETATION
SET 1: TABLE – PRODUCTION OF CARS (in thousands)
The following table shows the production of cars by 5 companies over 5 years:

Company 2018 2019 2020 2021 2022
A 45 50 40 55 60
B 30 35 25 40 50
C 55 60 45 50 65
        `);

        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            type: "paragraph",
        });
        expect(blocks[1]).toMatchObject({
            type: "table",
            hasHeader: true,
            rows: [
                ["Company", "2018", "2019", "2020", "2021", "2022"],
                ["A", "45", "50", "40", "55", "60"],
                ["B", "30", "35", "25", "40", "50"],
                ["C", "55", "60", "45", "50", "65"],
            ],
        });
    });

    it("extracts paired list blocks for match-the-following references", () => {
        const blocks = parseSharedContext(`
Match the following:

List I
1. Green Revolution
2. White Revolution

List II
a. Milk production
b. Food grains
        `);

        expect(blocks).toHaveLength(2);
        expect(blocks[1]).toMatchObject({
            type: "paired-list",
            sections: [
                {
                    title: "List I",
                    items: [
                        { label: "1", text: "Green Revolution" },
                        { label: "2", text: "White Revolution" },
                    ],
                },
                {
                    title: "List II",
                    items: [
                        { label: "a", text: "Milk production" },
                        { label: "b", text: "Food grains" },
                    ],
                },
            ],
        });
    });

    it("falls back to paragraph blocks for plain shared text", () => {
        const blocks = parseSharedContext(`
Read the passage carefully before answering the following questions.
Use the data above to compare the trends.
        `);

        expect(blocks).toEqual([
            {
                type: "paragraph",
                text: "Read the passage carefully before answering the following questions.\nUse the data above to compare the trends.",
            },
        ]);
    });
});
