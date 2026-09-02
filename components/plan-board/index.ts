// components/plan-board/index.ts
// AI 计划大框组件：整个页面视觉权重最高的区域。
// 由结构化 Plan 数据渲染，禁止使用纯文本 plan。

import { Plan } from '../../types/plan';
import { EventCandidate, EventCandidateGroup } from '../../types/event-candidate';
import { buildTimelineRows, TimelineRow } from '../../utils/timeline-rows';

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
    eventRows: [] as TimelineRow[],
  },
  observers: {
    'plan, candidateGroups'(plan: Plan | null, candidateGroups: EventCandidateGroup[]) {
      if (!plan) {
        this.setData({ eventRows: [] });
        return;
      }
      const groups = candidateGroups ?? [];
      // 严格交错：activity[0], route[0], activity[1], route[1], activity[2] ...
      // routeSegment[i] = activity[i] -> activity[i+1]，来自 event[i+1].route。
      this.setData({ eventRows: buildTimelineRows(plan.events, groups) });
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
