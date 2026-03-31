/** @format */

import { z } from "zod";

export const objectIdSchema = z.string({ error: "ID is required" }).regex(/^[0-9a-fA-F]{24}$/, "Invalid ID format");

export const idParamSchema = z.object({
    params: z.object({ id: objectIdSchema }),
});
