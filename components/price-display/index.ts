// components/price-display/index.ts
// 价格展示组件：将结构化 Price 渲染为文本。

import { Price } from '../../types/price';

Component({
  properties: {
    price: {
      type: Object,
      value: null as Price | null,
    },
    prefix: {
      type: String,
      value: '¥',
    },
  },
  methods: {
    formatPrice(): string {
      const p = this.data.price as Price | null;
      if (!p) return '';
      const unitMap: Record<string, string> = {
        TOTAL: '',
        PER_PERSON: '/ 人',
        PER_HOUR: '/ 小时',
      };
      const unit = unitMap[p.unit] ?? '';
      if (p.amount != null) return `${this.data.prefix}${p.amount}${unit}`;
      if (p.min != null && p.max != null) return `${this.data.prefix}${p.min} - ${this.data.prefix}${p.max}${unit}`;
      if (p.min != null) return `${this.data.prefix}${p.min}${unit}`;
      if (p.max != null) return `${this.data.prefix}${p.max}${unit}`;
      return '';
    },
  },
});