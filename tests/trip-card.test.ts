// tests/trip-card.test.ts
// Trip Card 数据驱动展示层测试（V0.3 Generic Trip Card Refactor）：
// - 0 / 1 / 2+ 事件 → EMPTY / SINGLE_EVENT / MULTI_EVENT
// - 事件类型 → 统一图标映射
// - 空 Trip 绝不出现 badminton / food 等 Mock 语义

import { PlanEvent, PlanEventType } from '../types/event';
import { deriveTripCardState, resolveEventIcon } from '../utils/trip-card';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

function eventFixture(type: PlanEventType, overrides: Partial<PlanEvent> = {}): PlanEvent {
  return {
    id: 'event_1',
    type,
    title: '事件',
    time: { start: '2026-08-22T11:30:00+08:00', timezone: 'Asia/Shanghai' },
    ...overrides,
  };
}

// ---- 1. 状态推导：0 / 1 / 2+ 事件 ----
{
  assert(deriveTripCardState([]) === 'EMPTY', '0 个事件 → EMPTY');
  assert(deriveTripCardState([eventFixture('SPORT')]) === 'SINGLE_EVENT', '1 个事件 → SINGLE_EVENT');
  assert(
    deriveTripCardState([eventFixture('SPORT'), eventFixture('DINING')]) === 'MULTI_EVENT',
    '2 个事件 → MULTI_EVENT'
  );
  assert(
    deriveTripCardState([
      eventFixture('SPORT'),
      eventFixture('TRANSPORT'),
      eventFixture('DINING'),
    ]) === 'MULTI_EVENT',
    '3 个事件 → MULTI_EVENT（展示 first → last）'
  );
}

// ---- 2. 空 Trip：不得出现任何 Mock 活动语义 ----
{
  const events: PlanEvent[] = [];
  const state = deriveTripCardState(events);
  const first = events[0];
  const firstIcon = first ? resolveEventIcon(first.type) : '';
  assert(state === 'EMPTY', '空 Trip 必须是 EMPTY');
  assert(firstIcon === '', '0 个事件时卡片不渲染任何事件图标');
  assert(!firstIcon.includes('badminton') && !firstIcon.includes('food'), '空状态不得出现 badminton/food');
}

// ---- 3. 事件类型图标映射 ----
{
  assert(resolveEventIcon('SPORT') === '/assets/icons/trip/sport.svg', 'SPORT → sport.svg');
  assert(resolveEventIcon('DINING') === '/assets/icons/trip/food.svg', 'DINING → food.svg');
  assert(resolveEventIcon('TRANSPORT') === '/assets/icons/trip/transport.svg', 'TRANSPORT → transport.svg');
  assert(
    resolveEventIcon('ENTERTAINMENT') === '/assets/icons/trip/entertainment.svg',
    'ENTERTAINMENT → entertainment.svg'
  );
  assert(resolveEventIcon('OTHER') === '/assets/icons/trip/generic-event.svg', 'OTHER → generic-event.svg');
  assert(resolveEventIcon(undefined) === '/assets/icons/trip/generic-event.svg', 'undefined → generic-event.svg');
  assert(resolveEventIcon(null) === '/assets/icons/trip/generic-event.svg', 'null → generic-event.svg');
}

console.log('✅ trip-card.test.ts 全部通过');
