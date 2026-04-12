type BatchInfo = {
    id: string
    name: string
    code: string
}

type AssignedTestLike = {
    id: string
    title: string
    assignedBatches: BatchInfo[]
}

export type StudentBatchCard = {
    id: string
    name: string
    code: string
    count: number
}

export const ALL_TESTS_BATCH_FILTER = 'ALL_TESTS'
export const DIRECT_ASSIGNMENTS_BATCH_FILTER = 'DIRECT_ASSIGNMENTS'

function normalizeSearchValue(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

export function matchesStudentTestSearch(title: string, query: string) {
    const normalizedQuery = normalizeSearchValue(query)
    if (!normalizedQuery) {
        return true
    }

    const normalizedTitle = normalizeSearchValue(title)
    return normalizedTitle.includes(normalizedQuery)
}

export function filterStudentTests<T extends AssignedTestLike>(
    tests: T[],
    searchQuery: string,
    selectedBatchId: string,
) {
    const matchingTests = tests.filter((test) => {
        if (!matchesStudentTestSearch(test.title, searchQuery)) {
            return false
        }

        if (selectedBatchId === ALL_TESTS_BATCH_FILTER) {
            return true
        }

        if (selectedBatchId === DIRECT_ASSIGNMENTS_BATCH_FILTER) {
            return test.assignedBatches.length === 0
        }

        return test.assignedBatches.some((batch) => batch.id === selectedBatchId)
    })

    return [...matchingTests].sort((left, right) => left.title.localeCompare(right.title))
}

export function buildStudentBatchCards<T extends AssignedTestLike>(
    tests: T[],
    batches: BatchInfo[],
) {
    const cards: StudentBatchCard[] = [
        {
            id: ALL_TESTS_BATCH_FILTER,
            name: 'All Tests',
            code: `${tests.length} total`,
            count: tests.length,
        },
    ]

    const directAssignmentsCount = tests.filter((test) => test.assignedBatches.length === 0).length
    if (directAssignmentsCount > 0) {
        cards.push({
            id: DIRECT_ASSIGNMENTS_BATCH_FILTER,
            name: 'Direct Assignments',
            code: 'PERSONAL',
            count: directAssignmentsCount,
        })
    }

    const sortedBatches = [...batches].sort((left, right) => left.name.localeCompare(right.name))

    for (const batch of sortedBatches) {
        cards.push({
            id: batch.id,
            name: batch.name,
            code: batch.code,
            count: tests.filter((test) => test.assignedBatches.some((assignedBatch) => assignedBatch.id === batch.id)).length,
        })
    }

    return cards
}
