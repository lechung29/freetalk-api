/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";

export const getOrCreateConversationSchema = z.object({
    body: z.object({
        targetId: objectIdSchema,
    }),
});

export const conversationIdParamSchema = z.object({
    params: z.object({ conversationId: objectIdSchema }),
});

export const getMessagesSchema = z.object({
    params: z.object({ conversationId: objectIdSchema }),
    query: z.object({
        limit: z.coerce.number().int().min(1).max(50).optional().default(20),
        before: z.string().optional(),
        around: z.string().optional(),
    }),
});

export const searchMessagesSchema = z.object({
    params: z.object({ conversationId: objectIdSchema }),
    query: z.object({
        keyword: z.string({ error: "Keyword is required for search" }).min(1, "Keyword is required for search"),
    }),
});

export type GetOrCreateConversationBody = z.infer<typeof getOrCreateConversationSchema>["body"];
export type GetMessagesQuery = z.infer<typeof getMessagesSchema>["query"];
