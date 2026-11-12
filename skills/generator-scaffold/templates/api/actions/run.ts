import { Problem } from '@api/http/problem';
import type { IAction, IActionContext } from './define';

/** Runs the named action from a registry. A disabled feature's action is not in the registry, so it is not found. */
export const runAction = async (
  registry: Readonly<Record<string, IAction>>, name: string, input: unknown, context: IActionContext,
): Promise<unknown> => {
  const action = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (action === undefined) { throw new Problem(404, `there is no action named ${name}`); }
  return action.run(input, context);
};
