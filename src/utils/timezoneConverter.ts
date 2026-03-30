/** @format */

/**
 * Normalize a date to UTC ISO string.
 *
 * The backend should keep timestamps stable (UTC) and let the client render
 * them according to the current viewer timezone.
 */
export function convertToUserTimezone(date: Date | string | number, _tz: string): string {
    try {
        const dateObj = new Date(date);
        if (Number.isNaN(dateObj.getTime())) {
            return new Date().toISOString();
        }
        return dateObj.toISOString();
    } catch (error) {
        console.error(`Error converting date to ISO:`, error);
        return new Date().toISOString();
    }
}

/**
 * Convert timestamp in object recursively.
 * Useful for converting createdAt, updatedAt fields in documents.
 */
export function convertTimestampsInObject<T extends Record<string, any>>(obj: T, tz: string, dateFields: string[] = ["createdAt", "updatedAt", "deletedAt"]): T {
    if (!obj) return obj;

    const converted: Record<string, any> = { ...obj };

    dateFields.forEach((field) => {
        if (field in converted && converted[field]) {
            try {
                converted[field] = convertToUserTimezone(converted[field], tz);
            } catch (error) {
                console.error(`Error converting field ${field}:`, error);
            }
        }
    });

    return converted as T;
}

/**
 * Convert array of objects with timestamps.
 */
export function convertTimestampsInArray<T extends Record<string, any>>(arr: T[], tz: string, dateFields?: string[]): T[] {
    if (!Array.isArray(arr)) return arr;

    return arr.map((item) => convertTimestampsInObject(item, tz, dateFields));
}
