export type BillingProduct =
  | {
      id: 'score_pack_10_test' | 'score_pack_50' | 'score_pack_100';
      kind: 'score_pack';
      name: string;
      description: string;
      currency: 'cny';
      unitAmount: number;
      scoreDelta: number;
    }
  | {
      id: 'pro_month_pass' | 'pro_year_pass';
      kind: 'pro_pass';
      name: string;
      description: string;
      currency: 'cny';
      unitAmount: number;
      billingCycle: 'monthly' | 'yearly';
    };

export const BILLING_PRODUCTS: Record<BillingProduct['id'], BillingProduct> = {
  score_pack_10_test: {
    id: 'score_pack_10_test',
    kind: 'score_pack',
    name: '10 AI学习分额度包',
    description: '测试支付：购买 10 AI学习分',
    currency: 'cny',
    unitAmount: 400,
    scoreDelta: 10,
  },
  score_pack_50: {
    id: 'score_pack_50',
    kind: 'score_pack',
    name: '50 AI学习分额度包',
    description: '购买 50 AI学习分',
    currency: 'cny',
    unitAmount: 500,
    scoreDelta: 50,
  },
  score_pack_100: {
    id: 'score_pack_100',
    kind: 'score_pack',
    name: '100 AI学习分额度包',
    description: '购买 100 AI学习分',
    currency: 'cny',
    unitAmount: 1000,
    scoreDelta: 100,
  },
  pro_month_pass: {
    id: 'pro_month_pass',
    kind: 'pro_pass',
    name: 'Linksy 专业版月卡',
    description: '购买专业版月卡',
    currency: 'cny',
    unitAmount: 2000,
    billingCycle: 'monthly',
  },
  pro_year_pass: {
    id: 'pro_year_pass',
    kind: 'pro_pass',
    name: 'Linksy 专业版年卡',
    description: '购买专业版年卡',
    currency: 'cny',
    unitAmount: 18800,
    billingCycle: 'yearly',
  },
};

export function getBillingProduct(productId: string) {
  return BILLING_PRODUCTS[productId as BillingProduct['id']] ?? null;
}

