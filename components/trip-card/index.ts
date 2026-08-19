// components/trip-card/index.ts
// 行程卡片组件：首页进行中行程与历史列表复用。

import { Trip } from '../../types/trip';

Component({
  properties: {
    trip: {
      type: Object,
      value: null as Trip | null,
    },
    /** 是否历史模式（展示创建/完成时间） */
    history: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    participantCount: 0,
    commentCount: 0,
    conflictCount: 0,
    createdText: '',
    completedText: '',
    firstTime: '',
    lastTime: '',
    firstEvent: '',
    lastEvent: '',
    firstLocation: '',
    lastLocation: '',
  },
  observers: {
    trip(trip: Trip | null) {
      if (!trip) return;
      const conflictCount = trip.currentPlan?.conflicts.length ?? 0;
      const events = trip.currentPlan?.events ?? [];
      const first = events[0];
      const last = events[events.length - 1];
      this.setData({
        participantCount: trip.participantIds.length,
        commentCount: trip.commentIds.length,
        conflictCount,
        createdText: this.formatDate(trip.createdAt),
        completedText: trip.completedAt ? this.formatDate(trip.completedAt) : '',
        firstTime: first?.time.start?.slice(11, 16) ?? '',
        lastTime: last?.time.start?.slice(11, 16) ?? '',
        firstEvent: first?.title ?? '',
        lastEvent: last?.title ?? '',
        firstLocation: first?.location?.name ?? '',
        lastLocation: last?.location?.name ?? '',
      });
    },
  },
  methods: {
    formatDate(iso: string): string {
      if (!iso) return '';
      return iso.slice(0, 16).replace('T', ' ');
    },
    onTap() {
      this.triggerEvent('tap', { trip: this.data.trip });
    },
  },
});
