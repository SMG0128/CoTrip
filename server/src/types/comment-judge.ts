// types/comment-judge.ts
// JudgeAgent 契约。
//
// JudgeAgent 只回答一个问题：
//   「这条输入是否包含足够的、与当前行程相关的可执行信息，值得交给 PlanAgent？」
//
// 它绝不回答「具体应该怎么改计划」—— 计划推理（增/删/改/查/移动/排序/时长/时间/地点）
// 全部属于 PlanAgent（TRIP_UPDATE / INITIAL_GENERATION）。

export type JudgeStatus = 'actionable' | 'irrelevant' | 'insufficient' | 'unsupported';

export type JudgeIntentDomain = 'trip' | 'non_trip' | 'unknown';

/** 确定性抽取的最小行程信号（可观测性，不作为 PlanAgent 的输入） */
export interface TripSignals {
  places: string[];
  timeExpressions: string[];
  durationExpressions: string[];
  sequenceWords: string[];
  actionWords: string[];
}

export interface JudgeResult {
  shouldForward: boolean;
  status: JudgeStatus;
  intentDomain: JudgeIntentDomain;
  signals: TripSignals;
  reason: string;
}
