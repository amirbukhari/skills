import { BILLING_TYPE_ACTIVE_FEATURE } from '@llws/hydra-shared';
import { ISubscriptionUsage } from '@src/rentsync-api/ISubscriptionUsage';
import { ISubscriptionCost } from '@src/rentsync-api/ISubscriptionCost';
import { getVolumeCostingItems } from './shared';

const billingTypeId = BILLING_TYPE_ACTIVE_FEATURE; // 15;

export function activeFeatureCostCalculator(usages: ISubscriptionUsage[]): ISubscriptionCost[] {
  // NOTE: We're assuming the incoming data will already be filtered for billingTypeId
  const subscriptions: ISubscriptionUsage[] = usages.filter((s) => s.billingTypeId === billingTypeId);

  const result: ISubscriptionCost[] = getVolumeCostingItems(subscriptions, billingTypeId);
  return result;
}
