import type { I__RESOURCE_PASCAL__SummaryInput, I__RESOURCE_PASCAL__SummaryOutput } from '@shared/generated/actions/__RESOURCE__';
import type { THandler } from '@api/actions/define';

/** Counts __RESOURCE__, optionally only those in one status. Hand-written: generation never overwrites this file. */
export const handler: THandler<I__RESOURCE_PASCAL__SummaryInput, I__RESOURCE_PASCAL__SummaryOutput> = async (input, { stores }) => {
  const rows = await stores.__RESOURCE_CAMEL__.list(input.status === null ? {} : { status: input.status });
  return { total: rows.length };
};
