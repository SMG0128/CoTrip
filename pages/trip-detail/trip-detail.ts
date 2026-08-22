// pages/trip-detail/trip-detail.ts
// 行程详情页：接入 Planning Pipeline + 真实地点 + Budget Planner 排序。
// 禁止用 setTimeout 伪装 AI，全部走真实规则引擎。

import { mockActiveTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
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
import { routeOptionService, tripService } from '../../services/index';
import { EventCandidateGroup } from '../../types/event-candidate';
import { ResolvedDestination, RouteOption } from '../../types/route-option';
import { buildEventCandidateGroups } from '../../utils/event-candidates';
import {
  extractNavigateTarget,
  resolveNextExpandedIndex,
  resolveRouteErrorText,
} from '../../utils/route-options-ui';
import {
  buildTripSharePayload,
  normalizeRoomCode,
  resolveRoomCodeDisplay,
  roomCopyFeedback,
} from '../../utils/trip-share';
import {
  buildUserComment,
  hydrateTripWithCurrentUser,
  isTripOwner,
  requireCurrentUser,
} from '../../utils/current-user';
import {
  buildCompleteTripModal,
  resolveCompleteTripPermission,
  runCompleteTripFlow,
} from '../../utils/trip-complete';
import { RealTripServiceError } from '../../services/real/real-trip-service';

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
    showRoute: false,
    // 我的推荐：路线方案选择器状态（懒加载——首次打开分段时才定位并规划）
    routeOptions: [] as RouteOption[],
    expandedRouteIndex: 0,
    routeLoading: false,
    routeErrorText: '',
    routesLoaded: false,
    /** 目的地解析结果（去导航的坐标兜底；来自服务返回，不本地伪造） */
    routeResolvedDestination: null as ResolvedDestination | null,
    inputText: '',
    participantCount: 0,
    commentCount: 0,
    // 完成行程：仅 owner + ACTIVE 展示入口；请求进行中防重复点击
    canCompleteTrip: false,
    isCompletingTrip: false,
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
      participantCount: trip.participantIds.length,
      commentCount: trip.commentIds.length,
      roomCode: resolveRoomCodeDisplay(trip.roomCode),
      hasRoomCode: !!normalizeRoomCode(trip.roomCode),
      // 完成行程入口：仅创建者 + 进行中可见（按 id 判断，禁止昵称判断）
      canCompleteTrip: isTripOwner(trip, currentUser) && trip.status === 'ACTIVE',
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

  /**
   * 完成行程入口：登录态守卫后走统一流程（权限/二次确认/防重复在 utils/trip-complete.ts）。
   * real 模式失败真实抛错：仅 toast 错误信息，绝不本地伪造 status/completedAt，绝不跳首页。
   */
  onCompleteTripTap() {
    // 登录态守卫：无 currentUser 时禁止操作，绝不回退到 Mock 用户
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请重新登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    runCompleteTripFlow({
      permission: resolveCompleteTripPermission(
        this.data.trip,
        guard.user,
        this.data.isCompletingTrip
      ),
      confirm: () =>
        new Promise<boolean>((resolve) =>
          wx.showModal({
            ...buildCompleteTripModal(),
            success: (res) => resolve(!!res.confirm),
            fail: () => resolve(false),
          })
        ),
      complete: () => {
        this.setData({ isCompletingTrip: true });
        return tripService.completeTrip(this.data.trip.id);
      },
      onSuccess: (completed) => {
        this.setData({ isCompletingTrip: false, trip: completed });
        wx.showToast({ title: '行程已完成', icon: 'success' });
        // 先让用户看到成功提示，再回首页
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1500);
      },
      onError: (error) => {
        this.setData({ isCompletingTrip: false });
        wx.showToast({
          title:
            error instanceof RealTripServiceError ? error.message : '操作失败，请稍后重试',
          icon: 'none',
        });
      },
    });
  },

  onToggleRoute() {
    const nextShow = !this.data.showRoute;
    this.setData({ showRoute: nextShow });
    // 懒加载：首次打开「我的推荐」时才定位并规划路线；失败后保留错误态，由「重新规划」显式重试
    if (
      nextShow &&
      !this.data.routesLoaded &&
      !this.data.routeLoading &&
      !this.data.routeErrorText
    ) {
      this.loadRouteOptions();
    }
  },

  /** wx.getLocation 包装为 Promise；用户拒绝/失败一律 reject，绝不伪造位置兜底 */
  getCurrentLocation(): Promise<{ latitude: number; longitude: number }> {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: () => reject(new Error('LOCATION_UNAVAILABLE')),
      });
    });
  },

  /**
   * 推导路线规划目的地名称：
   * 优先 currentPlan 第一个带地点 event 的 location.name；
   * 回退 trip.title 作为 POI 检索关键词；
   * 都没有则使用 V1 演示目的地「广州羽毛球中心羽毛球馆」（仅作为检索词传给服务，
   * 路线数据仍由地图 Provider 真实返回，不属于伪造路线数据兜底）。
   */
  resolveRouteDestinationName(): string {
    const events = this.data.trip.currentPlan?.events ?? [];
    const located = events.find((event) => !!event.location?.name);
    if (located?.location?.name) return located.location.name;
    const title = this.data.trip.title.trim();
    if (title) return title;
    // V1 演示目的地：与 Mock 场景一致的羽毛球馆
    return '广州羽毛球中心羽毛球馆';
  },

  /** 定位 → planRoutes 的完整加载链；失败态写入 routeErrorText（含重试入口），绝不静默回退 */
  async loadRouteOptions(): Promise<void> {
    // 登录态守卫沿用现有写法
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请重新登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    this.setData({ routeLoading: false, routeErrorText: '' });

    let origin: { latitude: number; longitude: number };
    try {
      origin = await this.getCurrentLocation();
    } catch {
      this.setData({
        routeLoading: false,
        routeErrorText: '无法获取当前位置，请允许定位后查看实时路线',
      });
      return;
    }

    this.setData({ routeLoading: true });
    try {
      const result = await routeOptionService.planRoutes({
        origin,
        destinationName: this.resolveRouteDestinationName(),
        city: '广州市',
        departureTime: this.data.trip.timeRange?.start,
      });
      this.setData({
        routeOptions: result.options,
        expandedRouteIndex: 0,
        routesLoaded: true,
        routeLoading: false,
        routeErrorText: '',
        routeResolvedDestination: result.resolvedDestination ?? null,
      });
    } catch (error) {
      this.setData({
        routeLoading: false,
        routeErrorText: resolveRouteErrorText(error),
      });
    }
  },

  /** 组件 toggle 事件：手风琴状态机（utils/route-options-ui.ts），同一时刻只有一条展开 */
  onRouteToggle(e: WechatMiniprogram.CustomEvent) {
    const clickedIndex = Number(e.detail?.index);
    if (!Number.isInteger(clickedIndex)) return;
    this.setData({
      expandedRouteIndex: resolveNextExpandedIndex(this.data.expandedRouteIndex, clickedIndex),
    });
  },

  /** 组件 navigate 事件：最后一个带坐标 step 优先，其次 resolvedDestination；无坐标只提示不伪造 */
  onRouteNavigate(e: WechatMiniprogram.CustomEvent) {
    const option = e.detail?.option as RouteOption | undefined;
    if (!option) return;
    const target = extractNavigateTarget(option, this.data.routeResolvedDestination);
    if (!target) {
      wx.showToast({ title: '暂无法打开导航', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: target.latitude,
      longitude: target.longitude,
      name: target.name,
    });
  },

  /** 「重新规划」：清空加载标记后重走完整加载链（重新定位 + 重新规划） */
  onRouteRetry() {
    this.setData({
      routesLoaded: false,
      routeOptions: [],
      routeResolvedDestination: null,
    });
    this.loadRouteOptions();
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
