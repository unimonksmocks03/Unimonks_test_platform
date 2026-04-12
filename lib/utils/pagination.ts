export type PaginationItem = number | 'ellipsis'

export function buildPaginationItems(page: number, totalPages: number): PaginationItem[] {
    if (totalPages <= 0) {
        return []
    }

    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1)
    }

    const pages = new Set<number>([1, totalPages, page - 1, page, page + 1])

    if (page <= 3) {
        pages.add(2)
        pages.add(3)
        pages.add(4)
    }

    if (page >= totalPages - 2) {
        pages.add(totalPages - 1)
        pages.add(totalPages - 2)
        pages.add(totalPages - 3)
    }

    const sortedPages = Array.from(pages)
        .filter((value) => value >= 1 && value <= totalPages)
        .sort((left, right) => left - right)

    const result: PaginationItem[] = []

    for (const currentPage of sortedPages) {
        const previousPage = result[result.length - 1]

        if (typeof previousPage === 'number' && currentPage - previousPage > 1) {
            result.push('ellipsis')
        }

        result.push(currentPage)
    }

    return result
}

export function getPaginationSummary(page: number, pageSize: number, totalItems: number) {
    if (totalItems <= 0) {
        return { start: 0, end: 0 }
    }

    const start = (page - 1) * pageSize + 1
    const end = Math.min(page * pageSize, totalItems)

    return { start, end }
}
