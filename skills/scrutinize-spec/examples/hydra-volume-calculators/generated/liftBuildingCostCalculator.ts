import { BILLING_TYPE_LIFT_BUILDING } from '@llws/hydra-shared';
import { ISubscriptionCost } from '@src/rentsync-api/ISubscriptionCost';
import { ISubscriptionUsage } from '@src/rentsync-api/ISubscriptionUsage';
import { buildingBillingTypeCostCalculator } from '../shared';

export const liftBuildingCostCalculator = (
  usages: ISubscriptionUsage[],
): ISubscriptionCost[] => buildingBillingTypeCostCalculator(usages, BILLING_TYPE_LIFT_BUILDING);
