export const PHONE_MIN_DIGITS = 10
export const PHONE_MAX_DIGITS = 15

function trimToNull(value: string | null | undefined) {
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
}

function stripInternationalPrefix(phone: string) {
    return phone.startsWith('00') ? phone.slice(2) : phone
}

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase()
}

export function normalizeOptionalEmail(email: string | null | undefined) {
    const trimmed = trimToNull(email)
    return trimmed ? normalizeEmail(trimmed) : null
}

export function normalizePhone(phone: string) {
    const trimmed = phone.trim()
    const withoutInternationalPrefix = stripInternationalPrefix(trimmed)
    return withoutInternationalPrefix.replace(/\D/g, '')
}

export function normalizeOptionalPhone(phone: string | null | undefined) {
    const trimmed = trimToNull(phone)
    return trimmed ? normalizePhone(trimmed) : null
}

export function isValidPhoneNumber(phone: string) {
    const normalized = normalizePhone(phone)
    return normalized.length >= PHONE_MIN_DIGITS && normalized.length <= PHONE_MAX_DIGITS
}
