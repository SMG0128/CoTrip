// types/price.ts
// 价格必须是结构化数据，禁止退化为纯字符串。

export type Currency = 'CNY';

export type PriceUnit = 'TOTAL' | 'PER_PERSON' | 'PER_HOUR';

export interface Price {
  /** 精确金额（与 min/max 二选一） */
  amount?: number;
  /** 区间下限 */
  min?: number;
  /** 区间上限 */
  max?: number;
  currency: Currency;
  unit: PriceUnit;
}