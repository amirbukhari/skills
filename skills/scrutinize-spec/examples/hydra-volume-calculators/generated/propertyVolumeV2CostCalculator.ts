import { BILLING_TYPE_PROPERTY_VOLUME_V2 } from '@llws/hydra-shared';
import { ISubscriptionUsage } from '../../../ISubscriptionUsage';
import { ISubscriptionCost } from '../../../ISubscriptionCost';
import { getVolumeCostingItems } from './shared';

const billingTypeId = BILLING_TYPE_PROPERTY_VOLUME_V2;

export function propertyVolumeV2CostCalculator(usages: ISubscriptionUsage[]): ISubscriptionCost[] {
  // NOTE: We're assuming the incoming data will already be filtered for billingTypeId
  const subscriptions: ISubscriptionUsage[] = usages.filter((s) => s.billingTypeId === billingTypeId);

  const result: ISubscriptionCost[] = getVolumeCostingItems(subscriptions, billingTypeId);
  return result;
}
