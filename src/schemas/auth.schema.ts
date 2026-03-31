/** @format */

import { z } from "zod";

export const loginWithGoogleSchema = z.object({
    body: z.object({
        email: z.string({ error: "Email is required" }).email("Invalid email address"),
        username: z.string({ error: "Username is required" }).min(1, "Username is required").max(50, "Username must not exceed 50 characters"),
        avatar: z.string().url("Invalid avatar URL").optional(),
    }),
});

export type LoginWithGoogleBody = z.infer<typeof loginWithGoogleSchema>["body"];
