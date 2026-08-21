// components/trip-card/index.ts
// 行程卡片组件：首页进行中行程与历史列表复用。
// 展示完全由 trip.currentPlan.events 真实数据推导（EMPTY / SINGLE_EVENT / MULTI_EVENT），
// 不再有任何 badminton / food 等 Mock 专属语义假设。

import { Trip } from '../../types/trip';
import { deriveTripCardState, resolveEventIcon, TripCardState } from '../../utils/trip-card';

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
    state: 'EMPTY' as TripCardState,
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
    firstIcon: '',
    lastIcon: '',
    emptyPlaceholderIcon: '/assets/icons/trip/planning-empty.svg',
  },
  observers: {
    trip(trip: Trip | null) {
      if (!trip) return;
      const events = trip.currentPlan?.events ?? [];
      const state = deriveTripCardState(events);
      const first = events[0];
      const last = state === 'MULTI_EVENT' ? events[events.length - 1] : undefined;
      this.setData({
        state,
        participantCount: trip.participantIds.length,
        commentCount: trip.commentIds.length,
        conflictCount: trip.currentPlan?.conflicts.length ?? 0,
        createdText: this.formatDate(trip.createdAt),
        completedText: trip.completedAt ? this.formatDate(trip.completedAt) : '',
        firstTime: first?.time.start?.slice(11, 16) ?? '',
        lastTime: last?.time.start?.slice(11, 16) ?? '',
        firstEvent: first?.title ?? '',
        lastEvent: last?.title ?? '',
        firstLocation: first?.location?.name ?? '',
        lastLocation: last?.location?.name ?? '',
        firstIcon: first ? resolveEventIcon(first.type) : '',
        lastIcon: last ? resolveEventIcon(last.type) : '',
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
