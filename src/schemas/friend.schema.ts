/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";

export const receiverIdParamSchema = z.object({
    params: z.object({ receiverId: objectIdSchema }),
});

export const requestIdParamSchema = z.object({
    params: z.object({ requestId: objectIdSchema }),
});

export const friendIdParamSchema = z.object({
    params: z.object({ friendId: objectIdSchema }),
});

export const targetIdParamSchema = z.object({
    params: z.object({ targetId: objectIdSchema }),
});
