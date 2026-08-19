// pages/trip-detail/trip-detail.ts
// 行程详情页：接入 Planning Pipeline + 真实地点 + Budget Planner 排序。
// 禁止用 setTimeout 伪装 AI，全部走真实规则引擎。

import { mockActiveTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
import { mockPersonalRoute, mockRouteSegments } from '../../mock/mock-routes';
import { mockCurrentUser } from '../../mock/mock-user';
import { realRestaurants } from '../../mock/mock-real-places';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';
import { Constraint } from '../../types/constraint';
import { Restaurant } from '../../types/restaurant';
import { PlanningEngine } from '../../core/planning-engine';
import { rankCandidates } from '../../core/candidate-ranker';
import { tencentMapProvider } from '../../services/providers/tencent-map-provider';
import { EventCandidateGroup } from '../../types/event-candidate';
import { buildEventCandidateGroups } from '../../utils/event-candidates';

// Debug 仅在开发版/体验版显示，正式版自动隐藏。
function isDebugEnabled(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
  } catch {
    return true;
  }
}

const DEBUG_ENABLED = isDebugEnabled();

Page({
  data: {
    trip: mockActiveTrip as Trip,
    comments: mockComments as Comment[],
    restaurants: realRestaurants as Restaurant[],
    rankedRestaurants: [] as ReturnType<typeof rankCandidates>,
    candidateGroups: [] as EventCandidateGroup[],
    route: mockPersonalRoute,
    routeSegments: mockRouteSegments,
    showRoute: false,
    inputText: '',
    participantCount: 0,
    commentCount: 0,
    // Debug 面板
    debugEnabled: DEBUG_ENABLED,
    debugExpanded: false,
    debugConstraints: [] as Constraint[],
    debugPlanVersion: 0,
    debugConflictCount: 0,
    debugUnresolved: [] as string[],
    // Provider Debug
    debugProvider: {
      provider: 'tencent_map',
      configured: tencentMapProvider.isConfigured,
      searchQuery: '',
      rawResultCount: 0,
      selectedEntity: '',
      providerRefs: [] as string[],
      externalActions: 0,
    },
  },

  engine: null as PlanningEngine | null,

  onLoad() {
    this.setData({
      participantCount: mockActiveTrip.participantIds.length,
      commentCount: mockActiveTrip.commentIds.length,
    });

    // 初始化规划引擎，注入初始计划
    this.engine = new PlanningEngine({
      tripId: mockActiveTrip.id,
      tripDate: '2026-08-22',
      timezone: 'Asia/Shanghai',
      initialPlan: mockActiveTrip.currentPlan,
    });

    // 用已有评论初始化约束
    this.runPipeline(mockComments);
  },

  /** 运行完整规划管线 */
  runPipeline(comments: Comment[]) {
    if (!this.engine) return;
    const result = this.engine.processComments(comments);

    // 更新评论状态：冲突的标记为 conflict，其余 accepted
    const updatedComments = this.data.comments.map((c) => {
      const isConflicted = result.conflicts.some((conf) =>
        conf.constraintIds.some((cid) =>
          result.constraints.some(
            (rc) => rc.id === cid && rc.sourceCommentId === c.id
          )
        )
      );
      if (isConflicted) return { ...c, aiStatus: 'conflict' as const };
      const hasConstraint = result.constraints.some((rc) => rc.sourceCommentId === c.id);
      if (hasConstraint) return { ...c, aiStatus: 'accepted' as const };
      return { ...c, aiStatus: 'unresolved' as const };
    });

    // Budget Planner 排序：根据约束对真实餐厅候选排序
    const ranked = rankCandidates({
      restaurants: realRestaurants,
      constraints: result.constraints,
    });
    const rankedRestaurants = ranked.map((r) => r.restaurant);
    const candidateGroups = buildEventCandidateGroups(result.plan, ranked);

    this.setData({
      comments: updatedComments,
      trip: { ...this.data.trip, currentPlan: result.plan },
      restaurants: rankedRestaurants,
      rankedRestaurants: ranked,
      candidateGroups,
      debugConstraints: result.constraints,
      debugPlanVersion: result.plan.version,
      debugConflictCount: result.conflicts.length,
      debugUnresolved: result.unresolvedCommentIds,
      'debugProvider.searchQuery': this.buildSearchQuery(result.constraints),
      'debugProvider.rawResultCount': realRestaurants.length,
      'debugProvider.selectedEntity': rankedRestaurants[0]?.name ?? '',
      'debugProvider.providerRefs': rankedRestaurants[0]?.providerRefs?.map((p) => `${p.provider}:${p.externalId}`) ?? [],
      'debugProvider.externalActions': rankedRestaurants[0]?.externalActions.length ?? 0,
    });
  },

  /** 从约束构建 Provider 搜索查询（Debug 展示用） */
  buildSearchQuery(constraints: Constraint[]): string {
    const dining = constraints.find((c) => c.scope === 'DINING');
    const district = constraints.find((c) => c.type === 'LOCATION')?.value.district as string | undefined;
    const keyword = dining ? '越南菜' : '餐厅';
    return `keyword=${keyword}, boundary=region(广州市, 0)${district ? `, district=${district}` : ''}`;
  },

  onInvite() {
    wx.showToast({ title: '邀请功能开发中', icon: 'none' });
  },

  onToggleRoute() {
    this.setData({ showRoute: !this.data.showRoute });
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ inputText: e.detail.value });
  },

  onSend() {
    const text = this.data.inputText.trim();
    if (!text) return;

    const newComment: Comment = {
      id: `comment_${Date.now()}`,
      tripId: mockActiveTrip.id,
      userId: mockCurrentUser.id,
      rawText: text,
      createdAt: new Date().toISOString(),
      aiStatus: 'processing',
    };

    this.setData({
      comments: [...this.data.comments, newComment],
      inputText: '',
      commentCount: this.data.commentCount + 1,
    });

    // 真实规则引擎处理，非 setTimeout 伪装
    this.runPipeline([newComment]);
  },

  onPlaceTap(e: WechatMiniprogram.CustomEvent) {
    const location = e.detail.location;
    if (!location) return;
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?locationId=${location.id}`,
    });
  },

  onRestaurantTap(e: WechatMiniprogram.CustomEvent) {
    const restaurant = e.detail.restaurant;
    if (!restaurant) return;
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?restaurantId=${restaurant.id}`,
    });
  },

  // ---- Debug 面板 ----
  onDebugToggle() {
    this.setData({ debugExpanded: !this.data.debugExpanded });
  },

  onDebugReset() {
    if (!this.engine) return;
    this.engine.reset();
    this.setData({
      comments: mockComments,
      trip: { ...this.data.trip, currentPlan: mockActiveTrip.currentPlan },
      restaurants: realRestaurants,
      rankedRestaurants: [],
      candidateGroups: buildEventCandidateGroups(mockActiveTrip.currentPlan, []),
      debugConstraints: [],
      debugPlanVersion: 0,
      debugConflictCount: 0,
      debugUnresolved: [],
    });
  },
});
