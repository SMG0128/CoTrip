// components/plan-board/index.ts
// AI 计划大框组件：整个页面视觉权重最高的区域。
// 由结构化 Plan 数据渲染，禁止使用纯文本 plan。

import { Plan } from '../../types/plan';
import { EventCandidate, EventCandidateGroup } from '../../types/event-candidate';

interface EventRow {
  id: string;
  event: Plan['events'][number];
  candidates: EventCandidate[];
}

Component({
  properties: {
    plan: {
      type: Object,
      value: null as Plan | null,
    },
    /** 已按 eventId 归属并排序的通用地点候选。 */
    candidateGroups: {
      type: Array,
      value: [] as EventCandidateGroup[],
    },
    /** 是否只读（历史封板） */
    readonly: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    eventRows: [] as EventRow[],
  },
  observers: {
    'plan, candidateGroups'(plan: Plan | null, candidateGroups: EventCandidateGroup[]) {
      if (!plan) {
        this.setData({ eventRows: [] });
        return;
      }
      const groups = candidateGroups ?? [];
      const eventRows = plan.events.map((event) => ({
        id: event.id,
        event,
        candidates: groups.find((group) => group.eventId === event.id)?.candidates ?? [],
      }));
      this.setData({ eventRows });
    },
  },
  methods: {
    onEventTap(e: WechatMiniprogram.BaseEvent) {
      const location = (e as WechatMiniprogram.CustomEvent).detail.location;
      if (!location) return;
      this.triggerEvent('place', { location });
    },
    onCandidateTap(e: WechatMiniprogram.CustomEvent) {
      const candidate = e.detail.candidate as EventCandidate | undefined;
      if (!candidate) return;
      if (candidate.restaurant) {
        this.triggerEvent('restaurant', { restaurant: candidate.restaurant });
        return;
      }
      this.triggerEvent('place', { location: candidate.location });
    },
  },
});
