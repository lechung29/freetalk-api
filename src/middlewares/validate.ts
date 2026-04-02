/** @format */

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { IResponseStatus } from "../models/users/usersModel";

export function validate(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse({
            body: req.body,
            params: req.params,
            query: req.query,
        });

        if (!result.success) {
            const firstIssue = result.error.issues[0];
            res.status(400).send({
                status: IResponseStatus.Error,
                message: firstIssue?.message ?? "Validation failed",
            });
            return;
        }

        const validated = result.data as Record<string, unknown>;
        if (validated.body !== undefined) req.body = validated.body;
        if (validated.params !== undefined) req.params = validated.params as Record<string, string>;
        if (validated.query !== undefined) req.query = validated.query as Record<string, string>;

        next();
    };
}
