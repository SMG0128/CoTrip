// utils/timeline-rows.ts
// 时间轴行构建：把「活动 + 相邻路线段」交错成渲染行。
//
// 数据语义（与后端 trip-plan-post-processor 一致）：
//   路线段 routeSegment[i] 永远表示 activity[i] -> activity[i + 1]。
//   后端把真实 route 挂在被到达的活动上：event[i+1].route.fromEventId === event[i].id。
//
// 因此渲染顺序必须是严格的 interleave：
//   activity[0]
//   route[0]（若存在）
//   activity[1]
//   route[1]（若存在）
//   activity[2]
//   ...
//
// 边界保证：
//   - 只有 1 个 Activity：不产生任何 route 行。
//   - 某一段没有 route 数据：不伪造交通方式，不产生空占位行，后续活动正常渲染。
//   - 第一项 Activity 上方、最后一项 Activity 下方绝不会出现 route。
//     （构造时只消费 event[i+1].route，天然排除这两处）

import { PlanEvent } from '../types/event';
import { EventCandidate, EventCandidateGroup } from '../types/event-candidate';
import { buildEventDateHeaders } from './event-date-grouping';

/** 路线 mode → 中文文案（与产品「步行/地铁/打车」一致） */
export function formatRouteMode(mode: 'transit' | 'walking' | 'driving'): string {
  if (mode === 'walking') return '步行';
  if (mode === 'driving') return '打车';
  return '地铁';
}

/** 渲染行：活动节点或低一级的路线段辅助节点 */
export type TimelineRow =
  | {
      kind: 'event';
      id: string;
      event: PlanEvent;
      candidates: EventCandidate[];
      /** 日期头文案（同一天后续事件为空串） */
      dateHeader: string;
      /** 是否为最后一个活动（控制活动竖线是否延伸） */
      isLast: boolean;
    }
  | {
      kind: 'route';
      id: string;
      /** 如「地铁 50 分钟」；仅真实路线段存在时产生 */
      routeText: string;
    };

/**
 * 构建交错的时间轴行。
 * @param events   按顺序排列的活动
 * @param groups   已按 eventId 归属的地点候选
 * @param dateHeaders 可选，缺省时内部调用 buildEventDateHeaders
 */
export function buildTimelineRows(
  events: PlanEvent[],
  groups: EventCandidateGroup[] = [],
  dateHeaders?: string[],
): TimelineRow[] {
  const headers = dateHeaders ?? buildEventDateHeaders(events);
  const rows: TimelineRow[] = [];

  events.forEach((event, index) => {
    rows.push({
      kind: 'event',
      id: event.id,
      event,
      candidates: groups.find((group) => group.eventId === event.id)?.candidates ?? [],
      dateHeader: headers[index] ?? '',
      isLast: index === events.length - 1,
    });

    // routeSegment[index] = activity[index] -> activity[index + 1]
    if (index < events.length - 1) {
      const next = events[index + 1];
      const route = next.route;
      // 只消费真实段：fromEventId 必须指向当前活动；缺失/不匹配时不伪造、不占位。
      if (route && route.fromEventId === event.id) {
        rows.push({
          kind: 'route',
          id: `route-${next.id}`,
          routeText: `${formatRouteMode(route.mode)} ${route.durationMinutes} 分钟`,
        });
      }
    }
  });

  return rows;
}
