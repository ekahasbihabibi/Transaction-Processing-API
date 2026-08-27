import { z } from "zod";
import { AppError } from "./app-error.js";

export function parseInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown
): z.infer<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "The request contains invalid data.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    );
  }
  return parsed.data;
}
