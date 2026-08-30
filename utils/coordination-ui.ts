// utils/coordination-ui.ts
// 行程协调区视图模型（纯函数，可单测）。
// 页面只消费 Server authoritative 的 coordination state + AI proposal，
// 本模块只负责「派生展示文案」，绝不重算约束/冲突，绝不伪造数据。

import {
  TripCoordinationState,
  TripCoordinationProposal,
  TripCoordinationStatus,
  TripCoordinationSuggestionKind,
} from '../types/coordination';

export interface CoordinationSuggestionVM {
  message: string;
  requiresConfirmation: boolean;
  kindLabel: string;
}

export interface CoordinationProposalVM {
  statusText: string;
  summary: string;
  suggestions: CoordinationSuggestionVM[];
}

export interface CoordinationVM {
  /** 是否展示协调区（Server/Mock 返回了协调状态） */
  showCard: boolean;
  /** 「待成员确认」徽标文案（无则空串，不显示徽标） */
  badgeText: string;
  /** AI 不可用提示文案（可用时为空串） */
  aiUnavailableText: string;
  stats: Array<{ label: string; value: number }>;
  /** 硬冲突横幅文案（无硬冲突为空串） */
  conflictBannerText: string;
  /** 软张力横幅文案（无软张力为空串） */
  tensionBannerText: string;
  /** 共同时间展示文案（无可用时间为空串，隐藏该行） */
  availabilityText: string;
  /** 共同预算展示文案（无预算为空串，隐藏该行） */
  budgetText: string;
  proposal: CoordinationProposalVM | null;
  /** 生成按钮文案（分析中… / 生成协调建议） */
  generateButtonLabel: string;
  /** 是否展示生成按钮（已有建议或分析中时隐藏） */
  showGenerateButton: boolean;
}

const STATUS_TEXT: Record<TripCoordinationStatus, string> = {
  READY: '已就绪',
  NEEDS_RESOLUTION: '需要协调',
  NEEDS_CONFIRMATION: '待确认',
};

const SUGGESTION_KIND_LABEL: Record<TripCoordinationSuggestionKind, string> = {
  ADJUST_TIME: '调整时间',
  RELAX_SOFT_PREFERENCE: '放宽偏好',
  REQUEST_CONFIRMATION: '请求确认',
  PRIORITIZE_PROXIMITY: '优先就近',
  OTHER: '其他建议',
};

export interface CoordinationVMInput {
  coordination: TripCoordinationState | null;
  proposal: TripCoordinationProposal | null | undefined;
  coordinationUnavailable: boolean;
  loading: boolean;
}

/** 派生协调区展示视图模型；任何输入都为 null/缺失时不抛错，返回空态 */
export function buildCoordinationVM(input: CoordinationVMInput): CoordinationVM {
  const { coordination, proposal, coordinationUnavailable, loading } = input;
  const hardConflicts = coordination?.hardConflicts ?? [];
  const softTensions = coordination?.softTensions ?? [];

  let availabilityText = '';
  if (coordination?.commonAvailability) {
    const after = coordination.commonAvailability.after;
    const until = coordination.commonAvailability.until;
    if (after || until) {
      availabilityText = `${after || '—'} - ${until || '待定'}`;
    }
  }

  let budgetText = '';
  if (coordination?.commonBudget) {
    const min = coordination.commonBudget.min;
    const max = coordination.commonBudget.max;
    const minText = min === undefined || min === null ? 0 : min;
    const maxText = max === undefined || max === null ? '不限' : max;
    budgetText = `¥${minText} - ¥${maxText}`;
  }

  const proposalVM: CoordinationProposalVM | null = proposal
    ? {
        statusText: STATUS_TEXT[proposal.status] ?? proposal.status,
        summary: proposal.summary,
        suggestions: (proposal.suggestions ?? []).map((s) => ({
          message: s.message,
          requiresConfirmation: !!s.requiresConfirmation,
          kindLabel: SUGGESTION_KIND_LABEL[s.kind] ?? '其他建议',
        })),
      }
    : null;

  const hasProposal = proposalVM !== null;

  return {
    showCard: !!coordination,
    badgeText:
      coordination?.requiresConfirmation || (coordination?.supersessionCandidates ?? []).length > 0
        ? '待成员确认'
        : '',
    aiUnavailableText: coordinationUnavailable ? 'AI 建议暂不可用' : '',
    stats: [
      { label: '已识别想法', value: coordination?.activeConstraintCount ?? 0 },
      { label: '硬性需求', value: coordination?.hardConstraintCount ?? 0 },
      { label: '偏好', value: coordination?.softConstraintCount ?? 0 },
    ],
    conflictBannerText:
      hardConflicts.length > 0 ? `有 ${hardConflicts.length} 项硬性需求需要协调` : '',
    tensionBannerText:
      hardConflicts.length === 0 && softTensions.length > 0
        ? `有 ${softTensions.length} 项偏好存在差异`
        : '',
    availabilityText,
    budgetText,
    proposal: proposalVM,
    generateButtonLabel: loading ? '分析中…' : '生成协调建议',
    showGenerateButton: !hasProposal && !loading,
  };
}
