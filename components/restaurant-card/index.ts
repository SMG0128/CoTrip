// components/restaurant-card/index.ts
// 餐厅卡片组件。

import { Restaurant } from '../../types/restaurant';

Component({
  properties: {
    restaurant: {
      type: Object,
      value: null as Restaurant | null,
    },
    index: {
      type: Number,
      value: 0,
    },
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { restaurant: this.data.restaurant });
    },
  },
});