// components/plan-event/index.ts
// 计划事件组件：展示单个事件（时间、标题、地点、价格）。

import { PlanEvent } from '../../types/event';
import { EventCandidate } from '../../types/event-candidate';

const TYPE_ASSET: Record<string, string> = {
  SPORT: '/assets/icons/trip/badminton.svg',
  DINING: '/assets/icons/trip/food.svg',
  TRANSPORT: '/assets/icons/trip/metro.svg',
  ENTERTAINMENT: '/assets/icons/utility/star.svg',
  OTHER: '/assets/icons/utility/location.svg',
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
    candidates: {
      type: Array,
      value: [] as EventCandidate[],
    },
  },
  data: {
    icon: '/assets/icons/utility/location.svg',
    timeText: '',
    selectedCandidate: null as EventCandidate | null,
    alternatives: [] as EventCandidate[],
    expanded: false,
  },
  observers: {
    'event, candidates'(event: PlanEvent | null, candidates: EventCandidate[]) {
      if (!event) return;
      const icon = TYPE_ASSET[event.type] ?? '/assets/icons/utility/location.svg';
      const start = (event.time.start || '').slice(11, 16);
      const end = event.time.end ? (event.time.end || '').slice(11, 16) : '';
      const timeText = end ? `${start} - ${end}` : start;
      const ranked = [...(candidates ?? [])].sort((a, b) => a.rank - b.rank);
      const selectedCandidate = ranked.find((candidate) => candidate.selected) ?? ranked[0] ?? null;
      const alternatives = selectedCandidate
        ? ranked.filter((candidate) => candidate.id !== selectedCandidate.id)
        : [];
      this.setData({ icon, timeText, selectedCandidate, alternatives, expanded: false });
    },
  },
  methods: {
    onPrimaryTap() {
      const selectedCandidate = this.data.selectedCandidate as EventCandidate | null;
      if (selectedCandidate) {
        this.triggerEvent('candidate', { candidate: selectedCandidate });
        return;
      }
      const event = this.data.event as PlanEvent | null;
      if (!event?.location) return;
      this.triggerEvent('place', { location: event.location });
    },
    onToggleCandidates() {
      this.setData({ expanded: !this.data.expanded });
    },
    onCandidateTap(e: WechatMiniprogram.BaseEvent) {
      const candidate = e.currentTarget.dataset.candidate as EventCandidate | undefined;
      if (!candidate) return;
      this.triggerEvent('candidate', { candidate });
    },
  },
});
