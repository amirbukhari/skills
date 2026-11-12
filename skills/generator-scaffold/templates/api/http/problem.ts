import type { z } from 'zod';

/** A refusal with the HTTP status that reports it. Anything else thrown is a bug, and is not caught as one. */
export class Problem extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'Problem';
  }
}

/** Parses a value against a contract schema, or refuses it with a 400 that says where it is wrong. */
export const parseOrProblem = <TSchema extends z.ZodType>(schema: TSchema, value: unknown): z.output<TSchema> => {
  const parsed = schema.safeParse(value);
  if (parsed.success) { return parsed.data; }
  throw new Problem(400, parsed.error.issues.map((issue) => (
    issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`
  )).join('; '));
};
