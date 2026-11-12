import type { z } from 'zod';
import type { IStores } from '@api/generated/resources/index';
import { parseOrProblem } from '@api/http/problem';

/** What a handler is given besides its input. Add what handlers need here: a clock, the caller, a transaction. */
export interface IActionContext {
  readonly stores: IStores;
}

export type THandler<TInput, TOutput> = (input: TInput, context: IActionContext) => Promise<TOutput>;

/** An action as the runner sees it: unvalidated input in, validated output out. */
export interface IAction {
  readonly name: string;
  readonly access: 'read' | 'mutating';
  run(input: unknown, context: IActionContext): Promise<unknown>;
}

/**
 * Wraps a handler with its generated schemas. Input is validated before the handler runs, and refused with a 400;
 * output is validated before it is sent, and an invalid one is a bug in the handler, so it throws.
 */
export const defineAction = <TInput extends z.ZodType, TOutput extends z.ZodType>(definition: {
  readonly name: string;
  readonly access: 'read' | 'mutating';
  readonly input: TInput;
  readonly output: TOutput;
  readonly handler: THandler<z.output<TInput>, z.input<TOutput>>;
}): IAction => ({
  name: definition.name,
  access: definition.access,
  run: async (input, context) => {
    const result = await definition.handler(parseOrProblem(definition.input, input), context);
    const output = definition.output.safeParse(result);
    if (!output.success) {
      throw new Error(`${definition.name} returned invalid output: ${output.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    return output.data;
  },
});
