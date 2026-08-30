// tests/coordination-ui.test.ts
// 行程协调区视图模型测试：
// 空态 / 硬冲突 / 软张力 / 待确认徽标 / 共同时间与预算 / AI 不可用 / AI 建议渲染 / 防御缺失字段。

import { buildCoordinationVM } from '../utils/coordination-ui';
import {
  TripCoordinationState,
  TripCoordinationProposal,
} from '../types/coordination';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

function state(overrides: Partial<TripCoordinationState> = {}): TripCoordinationState {
  return {
    tripId: 'trip_T',
    activeConstraintCount: 0,
    hardConstraintCount: 0,
    softConstraintCount: 0,
    participantCount: 2,
    hardConflicts: [],
    softTensions: [],
    supersessionCandidates: [],
    requiresConfirmation: false,
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

// 1. 空态：无协调状态 → 不展示协调区
{
  const vm = buildCoordinationVM({ coordination: null, proposal: null, coordinationUnavailable: false, loading: false });
  assert(vm.showCard === false, '空态不得展示协调区');
  assert(vm.badgeText === '', '空态无待确认徽标');
  assert(vm.conflictBannerText === '', '空态无冲突横幅');
  assert(vm.tensionBannerText === '', '空态无张力横幅');
  assert(vm.availabilityText === '', '空态无共同时间');
  assert(vm.budgetText === '', '空态无共同预算');
  assert(vm.proposal === null, '空态无 AI 建议');
}

// 2. 硬冲突：NO_COMMON_AVAILABILITY → 硬冲突横幅优先
{
  const vm = buildCoordinationVM({
    coordination: state({
      hardConstraintCount: 2,
      hardConflicts: [
        {
          id: 'conf_1', tripId: 'trip_T', kind: 'HARD_CONFLICT', dimension: 'AVAILABILITY',
          constraintIds: ['c1', 'c2'], participantUserIds: ['usr_A', 'usr_B'],
          reasonCode: 'NO_COMMON_AVAILABILITY', status: 'OPEN',
          createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.showCard === true, '有协调状态才展示协调区');
  assert(vm.conflictBannerText === '有 1 项硬性需求需要协调', '硬冲突横幅文案错误');
  assert(vm.tensionBannerText === '', '硬冲突存在时不得同时展示软张力横幅');
  assert(vm.stats[1].value === 2, '硬性需求统计错误');
}

// 3. 软张力：PREFERENCE_DIVERGENCE 且无硬冲突 → 软张力横幅
{
  const vm = buildCoordinationVM({
    coordination: state({
      softConstraintCount: 3,
      softTensions: [
        {
          id: 'tension_1', tripId: 'trip_T', kind: 'SOFT_TENSION', dimension: 'PREFERENCE',
          constraintIds: ['c3', 'c4'], participantUserIds: ['usr_A', 'usr_B'],
          reasonCode: 'PREFERENCE_DIVERGENCE', status: 'OPEN',
          createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.conflictBannerText === '', '无硬冲突时硬冲突横幅为空');
  assert(vm.tensionBannerText === '有 1 项偏好存在差异', '软张力横幅文案错误');
  assert(vm.stats[2].value === 3, '偏好统计错误');
}

// 4. 待确认：requiresConfirmation → 徽标「待成员确认」；无 → 空串
{
  const confirmVm = buildCoordinationVM({
    coordination: state({ requiresConfirmation: true, supersessionCandidates: [{ oldConstraintId: 'c1', newConstraintId: 'c2', userId: 'usr_A', type: 'AVAILABILITY', scope: 'TRIP' }] }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(confirmVm.badgeText === '待成员确认', 'requiresConfirmation 时必须有徽标');

  const plainVm = buildCoordinationVM({
    coordination: state({ requiresConfirmation: false }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(plainVm.badgeText === '', '无待确认时不显示徽标');
}

// 5. 共同时间与预算文本
{
  const vm = buildCoordinationVM({
    coordination: state({
      commonAvailability: { after: '16:00', until: '17:00' },
      commonBudget: { min: 0, max: 100 },
    }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.availabilityText === '16:00 - 17:00', '共同时间文本错误');
  assert(vm.budgetText === '¥0 - ¥100', '共同预算文本错误');
}

// 6. 时间/预算缺省分支：缺 after/until/min/max 时仍安全渲染
{
  const vm = buildCoordinationVM({
    coordination: state({
      commonAvailability: { after: '10:00' },
      commonBudget: { max: 200 },
    }),
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.availabilityText === '10:00 - 待定', '缺 until 时显示「待定」');
  assert(vm.budgetText === '¥0 - ¥200', '缺 min 时显示 0');
}

// 7. AI 不可用：coordinationUnavailable → 提示文案
{
  const vm = buildCoordinationVM({
    coordination: state(),
    proposal: null,
    coordinationUnavailable: true,
    loading: false,
  });
  assert(vm.aiUnavailableText === 'AI 建议暂不可用', 'AI 不可用提示缺失');
}

// 8. AI 建议渲染：status 文案、kind 标签、message、requiresConfirmation 标记
{
  const proposal: TripCoordinationProposal = {
    summary: '建议把羽毛球改到 16 点后',
    status: 'NEEDS_CONFIRMATION',
    suggestions: [
      { kind: 'ADJUST_TIME', affectedConstraintIds: ['c1'], message: '统一改为 16:00 后开始', requiresConfirmation: true, confidence: 0.8 },
      { kind: 'RELAX_SOFT_PREFERENCE', affectedConstraintIds: ['c2'], message: '餐厅偏好可先放宽', requiresConfirmation: false, confidence: 0.6 },
    ],
  };
  const vm = buildCoordinationVM({
    coordination: state(),
    proposal,
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.proposal !== null, '有建议时必须渲染建议区');
  assert(vm.proposal?.statusText === '待确认', 'NEEDS_CONFIRMATION 文案错误');
  assert(vm.proposal?.summary === '建议把羽毛球改到 16 点后', 'summary 透传错误');
  assert(vm.proposal?.suggestions.length === 2, '建议条数错误');
  assert(vm.proposal?.suggestions[0].kindLabel === '调整时间', 'ADJUST_TIME 标签错误');
  assert(vm.proposal?.suggestions[0].requiresConfirmation === true, 'requiresConfirmation 标记透传错误');
  assert(vm.proposal?.suggestions[1].kindLabel === '放宽偏好', 'RELAX_SOFT_PREFERENCE 标签错误');
  assert(vm.proposal?.suggestions[1].requiresConfirmation === false, '非确认建议不得误标');
  assert(vm.showGenerateButton === false, '已有建议时隐藏生成按钮');
}

// 9. 分析中：loading → 按钮文案「分析中…」且隐藏生成按钮
{
  const vm = buildCoordinationVM({
    coordination: state(),
    proposal: null,
    coordinationUnavailable: false,
    loading: true,
  });
  assert(vm.generateButtonLabel === '分析中…', 'loading 时按钮文案错误');
  assert(vm.showGenerateButton === false, 'loading 时不得展示可点击按钮');
}

// 10. 防御：缺数组字段的 coordination 不得抛错
{
  const broken = state({});
  const vm = buildCoordinationVM({
    coordination: broken,
    proposal: { summary: 's', status: 'READY', suggestions: [] },
    coordinationUnavailable: false,
    loading: false,
  });
  assert(vm.conflictBannerText === '', '缺 hardConflicts 时兜底为空');
  assert(vm.tensionBannerText === '', '缺 softTensions 时兜底为空');
  assert(vm.proposal?.statusText === '已就绪', 'READY 文案错误');
  assert(vm.proposal?.suggestions.length === 0, '空建议列表渲染为空');
}

console.log('✅ coordination-ui.test.ts 全部通过');
