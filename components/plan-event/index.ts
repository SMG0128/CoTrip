// components/plan-event/index.ts
// 计划事件组件：展示单个事件（时间、标题、地点、价格）。

import { PlanEvent } from '../../types/event';

const TYPE_ICON: Record<string, string> = {
  SPORT: '🏸',
  DINING: '🍜',
  TRANSPORT: '🚇',
  ENTERTAINMENT: '🎬',
  OTHER: '📍',
};

Component({
  properties: {
    event: {
      type: Object,
      value: null as PlanEvent | null,
    },
    isLast: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    icon: '📍',
    timeText: '',
  },
  observers: {
    event(event: PlanEvent | null) {
      if (!event) return;
      const icon = TYPE_ICON[event.type] ?? '📍';
      const start = (event.time.start || '').slice(11, 16);
      const end = event.time.end ? (event.time.end || '').slice(11, 16) : '';
      const timeText = end ? `${start} - ${end}` : start;
      this.setData({ icon, timeText });
    },
  },
});