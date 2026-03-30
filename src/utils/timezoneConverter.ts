/** @format */

/**
 * Convert date to ISO string with user's timezone
 * Uses Intl.DateTimeFormat to format date in user's timezone
 * @param date - Date object or timestamp
 * @param tz - User's timezone (e.g., 'Asia/Ho_Chi_Minh')
 * @returns ISO string representation with timezone offset applied
 */
export function convertToUserTimezone(date: Date | string | number, tz: string): string {
    if (!tz) {
        return new Date(date).toISOString();
    }

    try {
        const dateObj = new Date(date);

        // Format the date in the user's timezone
        const formatter = new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: tz,
        });

        const parts = formatter.formatToParts(dateObj);
        const values: Record<string, number> = {};

        parts.forEach((part) => {
            if (part.type !== "literal") {
                values[part.type] = parseInt(part.value, 10);
            }
        });

        // Create a new date with the timezone-specific values
        const tzDate = new Date(
            values.year || new Date().getFullYear(),
            (values.month || 1) - 1,
            values.day || 1,
            values.hour || 0,
            values.minute || 0,
            values.second || 0,
        );

        return tzDate.toISOString();
    } catch (error) {
        console.error(`Error converting to timezone ${tz}:`, error);
        return new Date(date).toISOString();
    }
}

/**
 * Convert timestamp in object recursively
 * Useful for converting createdAt, updatedAt fields in documents
 */
export function convertTimestampsInObject<T extends Record<string, any>>(
    obj: T,
    tz: string,
    dateFields: string[] = ["createdAt", "updatedAt", "deletedAt"],
): T {
    if (!tz || !obj) return obj;

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
 * Convert array of objects with timestamps
 */
export function convertTimestampsInArray<T extends Record<string, any>>(
    arr: T[],
    tz: string,
    dateFields?: string[],
): T[] {
    if (!tz || !Array.isArray(arr)) return arr;

    return arr.map((item) => convertTimestampsInObject(item, tz, dateFields));
}
