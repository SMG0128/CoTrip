// components/plan-board/index.ts
// AI 计划大框组件：整个页面视觉权重最高的区域。
// 由结构化 Plan 数据渲染，禁止使用纯文本 plan。

import { Plan } from '../../types/plan';
import { EventCandidate, EventCandidateGroup } from '../../types/event-candidate';
import { buildEventDateHeaders } from '../../utils/event-date-grouping';

interface EventRow {
  id: string;
  event: Plan['events'][number];
  candidates: EventCandidate[];
  /** 日期头文案（同一天后续事件为空串）；来自活动 local date，低干扰层级 */
  dateHeader: string;
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
      const dateHeaders = buildEventDateHeaders(plan.events);
      const eventRows = plan.events.map((event, index) => ({
        id: event.id,
        event,
        candidates: groups.find((group) => group.eventId === event.id)?.candidates ?? [],
        dateHeader: dateHeaders[index] ?? '',
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
