/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema.js";

export const blockTargetParamSchema = z.object({
    params: z.object({ targetId: objectIdSchema }),
});
