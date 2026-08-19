// components/plan-board/index.ts
// AI 计划大框组件：整个页面视觉权重最高的区域。
// 由结构化 Plan 数据渲染，禁止使用纯文本 plan。

import { Plan } from '../../types/plan';
import { Restaurant } from '../../types/restaurant';

Component({
  properties: {
    plan: {
      type: Object,
      value: null as Plan | null,
    },
    restaurants: {
      type: Array,
      value: [] as Restaurant[],
    },
    /** 是否只读（历史封板） */
    readonly: {
      type: Boolean,
      value: false,
    },
  },
  methods: {
    onEventTap(e: WechatMiniprogram.BaseEvent) {
      const event = e.currentTarget.dataset.event;
      if (!event || !event.location) return;
      this.triggerEvent('place', { location: event.location });
    },
    onRestaurantTap(e: WechatMiniprogram.BaseEvent) {
      const restaurant = e.currentTarget.dataset.restaurant;
      if (!restaurant) return;
      this.triggerEvent('restaurant', { restaurant });
    },
  },
});