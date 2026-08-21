// pages/trip-detail/trip-detail.ts
// 行程详情页：接入 Planning Pipeline + 真实地点 + Budget Planner 排序。
// 禁止用 setTimeout 伪装 AI，全部走真实规则引擎。

import { mockActiveTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
import { mockPersonalRoute, mockRouteSegments } from '../../mock/mock-routes';
import { realRestaurants } from '../../mock/mock-real-places';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';
import { Constraint } from '../../types/constraint';
import { Restaurant } from '../../types/restaurant';
import { Participant } from '../../types/participant';
import { Plan } from '../../types/plan';
import { PlanningEngine } from '../../core/planning-engine';
import { rankCandidates } from '../../core/candidate-ranker';
import { tencentMapProvider } from '../../services/providers/tencent-map-provider';
import { tripService } from '../../services/index';
import { EventCandidateGroup } from '../../types/event-candidate';
import { buildEventCandidateGroups } from '../../utils/event-candidates';
import {
  buildTripSharePayload,
  normalizeRoomCode,
  resolveRoomCodeDisplay,
  roomCopyFeedback,
} from '../../utils/trip-share';
import {
  buildUserComment,
  hydrateRouteOwner,
  hydrateTripWithCurrentUser,
  requireCurrentUser,
} from '../../utils/current-user';

// Debug 仅在开发版/体验版显示，正式版自动隐藏。
function isDebugEnabled(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
  } catch {
    return true;
  }
}

const DEBUG_ENABLED = isDebugEnabled();

/** 新 Trip 无初始计划时生成空骨架，避免 PlanBoard 空引用 */
function buildEmptyPlan(tripId: string): Plan {
  return {
    id: `plan_${tripId}`,
    tripId,
    version: 0,
    events: [],
    satisfiedConstraintCount: 0,
    totalConstraintCount: 0,
    conflicts: [],
    updatedAt: new Date().toISOString(),
  };
}

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
    // V0.3 Room UI：展示值 + 是否存在有效房间号（控制复制/分享能力）
    roomCode: resolveRoomCodeDisplay(mockActiveTrip.roomCode),
    hasRoomCode: !!normalizeRoomCode(mockActiveTrip.roomCode),
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

  onLoad(options?: Record<string, string | undefined>) {
    const app = getApp<IAppOption>();
    const currentUser = app.globalData.currentUser;
    const requestedTripId = options?.tripId;

    if (requestedTripId) {
      // 新创建的真实 Trip 通过 tripId 加载：creatorId/participantIds 天然属于 currentUser，
      // 不需要 Mock 占位身份；hydrate 对其幂等（no-op）。
      tripService.getTrip(requestedTripId).then((t) => {
        if (t) {
          this.bootstrapTrip(t, currentUser, false);
        } else {
          this.handleTripUnavailable('行程不存在');
        }
      }).catch(() => this.handleTripUnavailable('行程加载失败'));
      return;
    }

    // 默认进入 Mock 示例行程：运行时把旧 mock self 槽位替换为真实 currentUser
    this.bootstrapTrip(mockActiveTrip, currentUser, true);
  },

  handleTripUnavailable(message: string) {
    wx.showToast({ title: message, icon: 'none' });
    setTimeout(() => wx.navigateBack(), 800);
  },

  /** 初始化行程视图 + 规划引擎 */
  bootstrapTrip(baseTrip: Trip, currentUser: Participant | null, seedDemoComments: boolean) {
    // 旧 Mock fixture 的“自己”槽位在此替换为真实 currentUser；
    // 新 Trip 本来就是 currentUser.id，hydrate 不产生任何变化。
    const trip = hydrateTripWithCurrentUser(baseTrip, currentUser);
    const comments = seedDemoComments ? (mockComments as Comment[]) : ([] as Comment[]);
    const tripDate = trip.timeRange?.start?.slice(0, 10) ?? '2026-08-22';
    const timezone = trip.timeRange?.timezone ?? 'Asia/Shanghai';

    this.setData({
      trip: trip.currentPlan ? trip : { ...trip, currentPlan: buildEmptyPlan(trip.id) },
      comments,
      route: hydrateRouteOwner(mockPersonalRoute, currentUser),
      participantCount: trip.participantIds.length,
      commentCount: trip.commentIds.length,
      roomCode: resolveRoomCodeDisplay(trip.roomCode),
      hasRoomCode: !!normalizeRoomCode(trip.roomCode),
    });

    // 初始化规划引擎，注入初始计划
    this.engine = new PlanningEngine({
      tripId: trip.id,
      tripDate,
      timezone,
      initialPlan: trip.currentPlan,
    });

    // 用已有评论初始化约束（新 Trip 无评论，引擎生成空计划骨架）
    this.runPipeline(comments);
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

  /** 复制房间号：仅复制真实 roomCode，缺失时明确提示 */
  onCopyRoomCode() {
    const roomCode = normalizeRoomCode(this.data.trip.roomCode);
    if (!roomCode) {
      wx.showToast({ title: roomCopyFeedback(roomCode), icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: roomCode,
      success: () => wx.showToast({ title: roomCopyFeedback(roomCode), icon: 'none' }),
    });
  },

  /** 微信原生分享：有 roomCode 分享加入页，缺失时安全回退首页，绝不伪造 */
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const payload = buildTripSharePayload(this.data.trip);
    return { title: payload.title, path: payload.path };
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

    // 登录态守卫：无 currentUser 时禁止发送，绝不回退到 Mock 用户
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请重新登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    const newComment: Comment = buildUserComment(this.data.trip.id, text, guard.user);

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
