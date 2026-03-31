/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";

const MAX_GROUP_MEMBERS = 50;

export const createGroupSchema = z.object({
    body: z.object({
        name: z.string({ error: "Group name is required" }).min(1, "Group name is required").max(100, "Group name must not exceed 100 characters").trim(),
        description: z.string().max(500, "Description must not exceed 500 characters").optional().default(""),
        avatar: z.string().url("Invalid avatar URL").nullable().optional().default(null),
        invitedUserIds: z
            .array(z.string())
            .max(MAX_GROUP_MEMBERS - 1, `Cannot invite more than ${MAX_GROUP_MEMBERS - 1} users at once`)
            .optional()
            .default([]),
    }),
});

export const groupIdParamSchema = z.object({
    params: z.object({ groupId: objectIdSchema }),
});

export const inviteMembersSchema = z.object({
    params: z.object({ groupId: objectIdSchema }),
    body: z.object({
        userIds: z.array(z.string()).optional().default([]),
    }),
});

export const memberActionSchema = z.object({
    params: z.object({
        groupId: objectIdSchema,
        memberId: objectIdSchema,
    }),
});

export type CreateGroupBody = z.infer<typeof createGroupSchema>["body"];
export type InviteMembersBody = z.infer<typeof inviteMembersSchema>["body"];
