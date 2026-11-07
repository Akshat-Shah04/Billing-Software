import { z } from "zod";

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function parsePaging(query: unknown) {
  const { page, limit } = pagingSchema.parse(query);
  return { page, limit, offset: (page - 1) * limit };
}

/** Turns user text into a safe ILIKE pattern ("100%" must not act as a wildcard). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Empty strings become null so the database stores "no value" consistently. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
