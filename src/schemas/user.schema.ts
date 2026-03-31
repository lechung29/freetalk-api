/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";

export const getUserByIdSchema = z.object({
    params: z.object({ id: objectIdSchema }),
});

export const searchUsersSchema = z.object({
    query: z.object({
        search: z.string({ error: "Search query is required" }).min(1, "Search query is required"),
    }),
});

export const updateUserSchema = z.object({
    params: z.object({ id: objectIdSchema }),
    body: z
        .object({
            username: z.string().min(3, "Username must be at least 3 characters").max(50, "Username must not exceed 50 characters").trim().optional(),
            avatar: z.string().url("Invalid avatar URL format").max(2048, "Avatar URL must not exceed 2048 characters").optional(),
            location: z.string().max(300, "Location must not exceed 300 characters").optional(),
            timezone: z
                .string()
                .refine(
                    (tz) => {
                        if (!tz || tz.trim().length === 0) return true;
                        try {
                            Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
                            return true;
                        } catch {
                            return false;
                        }
                    },
                    { message: "Invalid timezone identifier" },
                )
                .optional(),
        })
        .refine((data) => Object.values(data).some((v) => v !== undefined), {
            message: "At least one field must be provided for update",
        }),
});

export type UpdateUserBody = z.infer<typeof updateUserSchema>["body"];
