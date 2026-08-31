// utils/ai-ui-config.ts
// AI UI 语义配置的前端消费层（纯函数，无 wx.* 依赖）。
//
// 职责边界：
//   - 只把服务端下发的语义配置整理成稳定的 ViewModel
//   - 版本过期（latestAIUI.planVersion !== currentPlan.version）一律丢弃，避免把
//     旧版本的「已更新」提示错误地贴到新计划上
//   - 防御式处理：字段缺失 / 类型异常一律降级为安全空值，绝不抛错阻断页面
//
// 明确不做：
//   - 不决定任何视觉表现（颜色、字体、动画、组件样式由 WXSS / 组件代码决定）
//   - 不根据评论文本推断 relevant / usable / updateRequired ——
//     计划是否更新完全由服务端 pipeline 决定，前端只读结果

import { AIUIConfig, emptyAIUIConfig } from '../types/ai-envelope';
import { Plan } from '../types/plan';
import { Trip } from '../types/trip';

export interface AIUIViewModel extends AIUIConfig {
  /** 提示是否对应当前计划版本；false 时上面所有字段均为空 */
  isCurrent: boolean;
  /** 便于 WXML 判断是否需要展示状态条 */
  hasMessage: boolean;
}

function safeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
}

function emptyViewModel(): AIUIViewModel {
  return { ...emptyAIUIConfig(), isCurrent: false, hasMessage: false };
}

/**
 * 解析当前应生效的 AI UI 提示。
 * 仅当 latestAIUI 对应当前 currentPlan.version 时才生效。
 */
export function resolveAIUIViewModel(trip: Pick<Trip, 'currentPlan' | 'latestAIUI'>): AIUIViewModel {
  const latest = trip.latestAIUI;
  const planVersion = trip.currentPlan?.version;
  if (!latest || typeof planVersion !== 'number') return emptyViewModel();
  // 版本不匹配：提示已过期，必须忽略
  if (latest.planVersion !== planVersion) return emptyViewModel();

  const ui = latest.ui;
  if (!ui || typeof ui !== 'object') return emptyViewModel();

  const message = typeof ui.message === 'string' && ui.message.trim() !== '' ? ui.message : null;
  return {
    changedEventIds: safeIdList(ui.changedEventIds),
    highlightEventIds: safeIdList(ui.highlightEventIds),
    removedEventIds: safeIdList(ui.removedEventIds),
    message,
    isCurrent: true,
    hasMessage: message !== null,
  };
}

/** 计划事件 + AI 语义标记；「怎么显示」仍由 WXML / WXSS 决定 */
export interface AnnotatedPlanEventFlags {
  id: string;
  aiChanged: boolean;
  aiHighlighted: boolean;
}

/**
 * 把语义配置投影到当前计划的事件上，供页面按需消费。
 * 只输出布尔标记，绝不输出样式值。
 */
export function buildEventUIFlags(
  plan: Plan | undefined,
  viewModel: AIUIViewModel,
): AnnotatedPlanEventFlags[] {
  if (!plan || !Array.isArray(plan.events)) return [];
  const changed = new Set(viewModel.changedEventIds);
  const highlighted = new Set(viewModel.highlightEventIds);
  return plan.events.map((event) => ({
    id: event.id,
    aiChanged: changed.has(event.id),
    aiHighlighted: highlighted.has(event.id),
  }));
}
