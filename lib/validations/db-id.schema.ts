import { z } from 'zod'

const DATABASE_UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function dbUuid(message: string) {
    return z.string().trim().regex(DATABASE_UUID_PATTERN, message)
}

export const DbUuidSchema = dbUuid('Valid ID is required')
