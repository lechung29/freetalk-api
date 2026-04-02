/** @format */

import { z } from "zod";
import { objectIdSchema } from "./common.schema";

export const notificationIdParamSchema = z.object({
    params: z.object({ id: objectIdSchema }),
});
