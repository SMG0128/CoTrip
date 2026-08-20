// 后端独立 Trip 模型；不依赖微信小程序 runtime 类型。

export type TripStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Trip {
  id: string;
  title: string;
  status: TripStatus;
  creatorId: string;
  participantIds: string[];
  createdAt: string;
  completedAt?: string;
  initialBrief: string;
  areaConstraint?: unknown;
  timeRange?: unknown;
  currentPlan?: unknown;
  commentIds: string[];
  constraintIds: string[];
}

export interface CreateTripInput {
  title: string;
  initialBrief: string;
  areaConstraint?: unknown;
  timeRange?: unknown;
}
