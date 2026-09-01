// pages/trip-detail/trip-detail.ts
// 行程详情页：接入 Planning Pipeline + 真实地点 + Budget Planner 排序。
// 禁止用 setTimeout 伪装 AI，全部走真实规则引擎。

import { mockComments } from '../../mock/mock-comments';
import { realRestaurants } from '../../mock/mock-real-places';
import { appConfig } from '../../config/auth';
import { buildDemoTrip, guardDemoTripWrite, isDemoTripId } from '../../utils/demo-trip';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';
import { Constraint } from '../../types/constraint';
import { Restaurant } from '../../types/restaurant';
import { Participant } from '../../types/participant';
import { Location } from '../../types/location';
import { Plan } from '../../types/plan';
import { PlanningEngine } from '../../core/planning-engine';
import { rankCandidates } from '../../core/candidate-ranker';
import { tencentMapProvider } from '../../services/providers/tencent-map-provider';
import {
  tripService,
  routeOptionService,
  commentService,
  coordinationService,
} from '../../services/index';
import { MockCoordinationService } from '../../services/mock/mock-coordination-service';
import { TripCoordinationState } from '../../types/coordination';
import { CoordinationResult } from '../../services/coordination-service';
import { buildCoordinationVM, CoordinationVM } from '../../utils/coordination-ui';
import { MockRouteOptionService } from '../../services/route-option-service';
import { EventCandidateGroup } from '../../types/event-candidate';
import { ResolvedDestination, RouteOption, RoutePlanQuery } from '../../types/route-option';
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
  buildDeparturePlace,
  loadDeparturePlaces,
  mergeDeparturePlace,
  saveDeparturePlaces,
} from '../../utils/departure-places';
import {
  DeparturePoint,
  PersonalRouteBlockReason,
  resolveDefaultDeparturePlace,
  resolvePersonalRouteGate,
} from '../../utils/personal-route';
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
import {
  buildDeleteTripModal,
  resolveDeleteTripPermission,
  runDeleteTripFlow,
  shouldShowDeleteEntry,
} from '../../utils/trip-delete';
import { RealTripServiceError } from '../../services/real/real-trip-service';
import {
  commitServerComment,
  createTempCommentId,
  mergeServerComments,
} from '../../utils/comment-sync';
import { evaluateRealCommentPlan } from '../../utils/real-comment-planning';
import { AIUIViewModel, buildEventUIFlags, resolveAIUIViewModel } from '../../utils/ai-ui-config';
import { resolveTripDetailOnShowActions } from '../../utils/trip-detail-on-show';
import {
  buildKeyboardHeightPatch,
  COMPOSER_BOTTOM_DEFAULT,
  DETAIL_BOTTOM_PADDING_BASE,
} from '../../utils/comment-composer';

// Debug 仅在开发版/体验版显示，正式版自动隐藏。
function isDebugEnabled(): boolean {
  try {
    return wx.getAccountInfoSync().miniProgram.envVersion !== 'release';
  } catch {
    return true;
  }
}

const DEBUG_ENABLED = isDebugEnabled();
// 内置示例行程专用路线服务：固化广州 fixture，开箱即用——
// 示例行程与真实行程一致：首地点就绪后面板先展示「请选择出发地点」选点面板（不自动调用），
// 选定后走本服务读取 fixture（不消费 query、不依赖出发地点），且永不触达腾讯 API。
const demoRouteOptionService = new MockRouteOptionService();

/** 协调区初始空态视图模型（页面加载完成前展示） */
function buildInitialCoordinationVM(): CoordinationVM {
  return buildCoordinationVM({
    coordination: null,
    proposal: null,
    coordinationUnavailable: false,
    loading: false,
  });
}

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
    // 页面壳默认值：onLoad 的所有分支都会立即以真实数据或示例行程覆盖
    trip: buildDemoTrip(),
    comments: [] as Comment[],
    restaurants: [] as Restaurant[],
    rankedRestaurants: [] as ReturnType<typeof rankCandidates>,
    candidateGroups: [] as EventCandidateGroup[],
    showRoute: false,
    // 我的推荐：路线方案选择器状态（懒加载——首次打开分段时才走门禁并规划）；
    // expandedRouteIndex: null 表示全部收起（不变量：同一时刻展开数 ∈ {0, 1}）
    routeOptions: [] as RouteOption[],
    expandedRouteIndex: 0 as number | null,
    routeLoading: false,
    routeErrorText: '',
    /** 被「第一个地点」门禁拦截的原因（空串 = 未被门禁拦截） */
    routeBlockReason: '' as '' | PersonalRouteBlockReason,
    /** 首地点已就绪但尚未选出发地点：面板显示「请选择出发地点」两按钮，不自动调用 */
    routeNeedsOrigin: false,
    /** 本会话选定的出发点（使用保存地点 / 地图选点），选定后才发起规划 */
    routeOrigin: null as DeparturePoint | null,
    /** 「使用保存地点」按钮的候选地点；无则按钮变为「设置出发地点」引导 */
    savedDeparture: null as Location | null,
    /** 首地点名：选点面板展示「目的地」 */
    routeDestinationName: '',
    routesLoaded: false,
    /** 目的地解析结果（去导航的坐标兜底；来自服务返回，不本地伪造） */
    routeResolvedDestination: null as ResolvedDestination | null,
    inputText: '',
    // 键盘避让：真实键盘高度（px，来自 wx.onKeyboardHeightChange），0 = 键盘收起。
    // 单位换算与 bottom/留白计算见 utils/comment-composer.ts。
    keyboardHeight: 0,
    composerBottom: COMPOSER_BOTTOM_DEFAULT,
    detailBottomPadding: DETAIL_BOTTOM_PADDING_BASE,
    participantCount: 0,
    commentCount: 0,
    // 行程协调状态（Server authoritative；示例行程使用 Mock；AI 未配置时 coordinationUnavailable=true）
    coordination: null as TripCoordinationState | null,
    coordinationProposal: null as CoordinationResult['proposal'] | null,
    coordinationUnavailable: false,
    coordinationLoading: false,
    /** 协调区展示视图模型（由 utils/coordination-ui.ts 派生，仅渲染用，不重算） */
    coordVM: buildInitialCoordinationVM(),
    /**
     * AI Trip Pipeline V2 Stage 3：服务端下发的 UI 语义提示（哪些条目变化 / 高亮 / 一句消息）。
     * 仅承载语义，视觉表现由 WXML / WXSS 决定；版本过期时自动降级为空（见 utils/ai-ui-config.ts）。
     */
    aiUI: null as AIUIViewModel | null,
    aiEventFlags: [] as ReturnType<typeof buildEventUIFlags>,
    // 完成行程：仅 owner + ACTIVE 展示入口；请求进行中防重复点击
    canCompleteTrip: false,
    isCompletingTrip: false,
    // 删除行程：仅 owner（且非示例行程）展示圆形垃圾桶入口；请求进行中防重复提交
    canDeleteTrip: false,
    isDeletingTrip: false,
    // V0.3 Room UI：展示值 + 是否存在有效房间号（控制复制/分享能力）
    roomCode: resolveRoomCodeDisplay(undefined),
    hasRoomCode: false,
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
  /** 进入页面时的初始快照，供 Debug 面板「重置」恢复（示例与真实 Trip 各自正确复位） */
  initialSnapshot: null as { trip: Trip; comments: Comment[] } | null,
  /** 键盘高度监听器引用：onLoad 注册、onUnload 移除，防止重复注册/内存泄漏 */
  keyboardHeightHandler: null as WechatMiniprogram.OnKeyboardHeightChangeCallback | null,

  onLoad(options?: Record<string, string | undefined>) {
    // 键盘避让：注册真实键盘高度监听（页面卸载时必须在 onUnload 中 off，见下）
    const keyboardHeightHandler = this.onKeyboardHeightChange.bind(this);
    this.keyboardHeightHandler = keyboardHeightHandler;
    wx.onKeyboardHeightChange(keyboardHeightHandler);

    const app = getApp<IAppOption>();
    const currentUser = app.globalData.currentUser;
    const requestedTripId = options?.tripId;

    if (requestedTripId && isDemoTripId(requestedTripId)) {
      // 示例行程：纯本地展示，绝不请求后端、绝不进入真实 repository
      if (appConfig.enableDemoTrip) {
        this.bootstrapTrip(buildDemoTrip(), currentUser, true);
      } else {
        this.handleTripUnavailable('行程不存在');
      }
      return;
    }

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

    // 无参数直达（开发路径）：示例行程开启时本地展示，否则按无效处理
    if (appConfig.enableDemoTrip) {
      this.bootstrapTrip(buildDemoTrip(), currentUser, true);
    } else {
      this.handleTripUnavailable('缺少行程参数');
    }
  },

  handleTripUnavailable(message: string) {
    wx.showToast({ title: message, icon: 'none' });
    setTimeout(() => wx.navigateBack(), 800);
  },

  /**
   * 回到本页时重新评估「我的推荐」：仅当面板正开着、且处于「缺首地点」拦截或
   * 「等待选出发地点」状态才重走加载链（例如首地点刚生成、用户刚从「出发设置」
   * 保存了出发点）——避免每次前后台切换都重新规划已有路线。
   */
  onShow() {
    const actions = resolveTripDetailOnShowActions({
      tripId: this.data.trip.id,
      showRoute: this.data.showRoute,
      routeLoading: this.data.routeLoading,
      routeBlockReason: this.data.routeBlockReason,
      routeNeedsOrigin: this.data.routeNeedsOrigin,
    });
    // 真实行程：每次回到页面都以服务端评论流为 source of truth 刷新
    // （示例行程纯本地展示，跳过；首次进入时 trip 尚未 bootstrap 完成，由 bootstrapTrip 拉取）
    if (actions.refreshComments) {
      this.loadServerComments(this.data.trip.id);
      // 新评论可能产生新约束 → 协调状态随之刷新（Server 重算，不信任本地）
      this.loadCoordination(this.data.trip.id);
    }

    // 路线恢复是独立生命周期；它的门禁不得阻断上面的评论刷新。
    if (actions.loadRouteOptions) this.loadRouteOptions();
  },

  /**
   * wx.onKeyboardHeightChange 回调：把真实键盘高度（px）写入 data。
   * 输入栏 bottom 与页面底部留白随键盘同步（换算见 utils/comment-composer.ts）：
   * height > 0 → 输入栏紧贴键盘上沿；height = 0 → 恢复到底部安全区位置。
   * 回调中的 height 是 px，绝不能当 rpx 使用。
   */
  onKeyboardHeightChange(res: WechatMiniprogram.OnKeyboardHeightChangeListenerResult) {
    this.setData(buildKeyboardHeightPatch(res.height));
  },

  /** 页面卸载：必须移除全局键盘监听，防止重复注册与内存泄漏 */
  onUnload() {
    if (this.keyboardHeightHandler) {
      wx.offKeyboardHeightChange(this.keyboardHeightHandler);
      this.keyboardHeightHandler = null;
    }
  },

  /** 初始化行程视图 + 规划引擎 */
  bootstrapTrip(baseTrip: Trip, currentUser: Participant | null, seedDemoComments: boolean) {
    // 旧 Mock fixture 的“自己”槽位在此替换为真实 currentUser；
    // 新 Trip 本来就是 currentUser.id，hydrate 不产生任何变化。
    const trip = hydrateTripWithCurrentUser(baseTrip, currentUser);
    const comments = seedDemoComments
      ? mockComments.map((comment) => ({ ...comment, tripId: trip.id }))
      : ([] as Comment[]);
    const tripDate = trip.timeRange?.start?.slice(0, 10) ?? '2026-08-22';
    const timezone = trip.timeRange?.timezone ?? 'Asia/Shanghai';

    // 记录初始快照：Debug 重置恢复到本行程自身的初始状态（而非固定 Mock 数据）
    this.initialSnapshot = { trip, comments };

    this.setData({
      trip: trip.currentPlan ? trip : { ...trip, currentPlan: buildEmptyPlan(trip.id) },
      comments,
      participantCount: trip.participantIds.length,
      // 评论计数以实际评论列表为准（真实行程在服务端拉取后更新，示例行程为内置评论数）
      commentCount: comments.length,
      roomCode: resolveRoomCodeDisplay(trip.roomCode),
      hasRoomCode: !!normalizeRoomCode(trip.roomCode),
      // 完成行程入口：仅创建者 + 进行中可见（按 id 判断，禁止昵称判断）
      canCompleteTrip: isTripOwner(trip, currentUser) && trip.status === 'ACTIVE',
      // 删除行程入口：仅创建者可见；示例行程永不显示（hydrate 后 owner 判断会误命中 demo）
      canDeleteTrip: shouldShowDeleteEntry(trip, currentUser),
    });

    // 消费服务端下发的 AI UI 语义提示（版本不匹配时自动降级为空）
    this.applyAIUIState(trip);

    // 初始化规划引擎，注入初始计划
    this.engine = new PlanningEngine({
      tripId: trip.id,
      tripDate,
      timezone,
      initialPlan: trip.currentPlan,
    });

    // 用已有评论初始化约束（新 Trip 无评论，引擎生成空计划骨架）
    this.runPipeline(comments);

    // 真实行程：评论以服务端为 source of truth，异步拉取并重跑管线；
    // 示例行程（seedDemoComments=true）纯本地展示，不请求后端。
    if (!seedDemoComments) {
      this.loadServerComments(trip.id);
    }

    // 协调状态（真实行程 → Server；示例行程 → Mock），AI 未配置时 coordinationUnavailable=true
    this.loadCoordination(trip.id);
  },

  /**
   * 真实行程评论流：拉取共享实体（tripId）下的全部评论并合入本地。
   * 服务端为最终真相（按 id 去重）；本地未确认的乐观项暂保留，已确认项以服务端为准。
   * 失败明确提示，保留当前列表，绝不伪造数据。
   */
  async loadServerComments(tripId: string): Promise<void> {
    try {
      const server = await commentService.listComments(tripId);
      const merged = mergeServerComments(this.data.comments, server);
      this.setData({ comments: merged, commentCount: merged.length });
      this.runPipeline(merged);
    } catch (error) {
      wx.showToast({ title: '评论加载失败', icon: 'none' });
    }
  },

  /**
   * 加载行程协调状态（Server authoritative；示例行程使用 Mock，真实行程严禁 fallback）。
   * 协调状态来自 Server Constraint Ledger + deterministic evaluator：
   * 页面不重算、不信任本地约束，只渲染 Server 结果。
   * AI 协调建议失败时 coordinationUnavailable=true，保留确定性状态，不伪造建议。
   */
  async loadCoordination(tripId: string): Promise<void> {
    if (isDemoTripId(tripId)) {
      // 示例行程：纯本地 Mock（确定性 mock data），与真实行程严格隔离
      const mock = new MockCoordinationService();
      try {
        const result = await mock.getCoordination(tripId);
        this.setData({
          coordination: result.coordination,
          coordinationProposal: result.proposal ?? null,
          coordinationUnavailable: result.coordinationUnavailable,
          coordinationLoading: false,
          coordVM: buildCoordinationVM({
            coordination: result.coordination,
            proposal: result.proposal ?? null,
            coordinationUnavailable: result.coordinationUnavailable,
            loading: false,
          }),
        });
      } catch {
        this.setData({ coordinationLoading: false, coordVM: buildInitialCoordinationVM() });
      }
      return;
    }

    this.setData({ coordinationLoading: true });
    try {
      const result = await coordinationService.getCoordination(tripId);
      this.setData({
        coordination: result.coordination,
        coordinationProposal: result.proposal ?? null,
        coordinationUnavailable: result.coordinationUnavailable,
        coordinationLoading: false,
        coordVM: buildCoordinationVM({
          coordination: result.coordination,
          proposal: result.proposal ?? null,
          coordinationUnavailable: result.coordinationUnavailable,
          loading: false,
        }),
      });
    } catch (error) {
      // 协调状态加载失败：保留空状态，不伪造、不阻断页面
      this.setData({
        coordination: null,
        coordinationProposal: null,
        coordinationUnavailable: true,
        coordinationLoading: false,
        coordVM: buildCoordinationVM({
          coordination: null,
          proposal: null,
          coordinationUnavailable: true,
          loading: false,
        }),
      });
    }
  },

  /** 请求 AI 协调建议（真实行程专用；示例行程用 Mock 即时返回） */
  async onAnalyzeCoordination() {
    const tripId = this.data.trip.id;
    if (isDemoTripId(tripId)) {
      const mock = new MockCoordinationService();
      const result = await mock.analyze(tripId);
      this.setData({
        coordinationProposal: result.proposal ?? null,
        coordinationUnavailable: result.coordinationUnavailable,
        coordVM: buildCoordinationVM({
          coordination: this.data.coordination,
          proposal: result.proposal ?? null,
          coordinationUnavailable: result.coordinationUnavailable,
          loading: false,
        }),
      });
      return;
    }
    this.setData({ coordinationLoading: true });
    try {
      const result = await coordinationService.analyze(tripId);
      this.setData({
        coordination: result.coordination,
        coordinationProposal: result.proposal ?? null,
        coordinationUnavailable: result.coordinationUnavailable,
        coordinationLoading: false,
        coordVM: buildCoordinationVM({
          coordination: result.coordination,
          proposal: result.proposal ?? null,
          coordinationUnavailable: result.coordinationUnavailable,
          loading: false,
        }),
      });
    } catch {
      this.setData({
        coordinationLoading: false,
        coordVM: buildCoordinationVM({
          coordination: this.data.coordination,
          proposal: this.data.coordinationProposal,
          coordinationUnavailable: this.data.coordinationUnavailable,
          loading: false,
        }),
      });
    }
  },

  /** 运行完整规划管线 */
  runPipeline(comments: Comment[]) {
    // 真实评论只消费服务端权威 aiStatus/aiAnalysis，绝不调用规则 Parser 或 Mock AI。
    if (!isDemoTripId(this.data.trip.id)) {
      const currentPlan = this.data.trip.currentPlan ?? buildEmptyPlan(this.data.trip.id);
      const result = evaluateRealCommentPlan(currentPlan, comments);
      // 真实行程：候选只来自服务端计划中的已验证实体（腾讯 POI / nearby 结果），
      // 绝不使用任何本地 mock 餐厅（蔡澜Pho 等 seed fixture）。
      const candidateGroups = buildEventCandidateGroups(result.plan, []);
      const planRestaurants = candidateGroups
        .flatMap((group) => group.candidates)
        .map((candidate) => candidate.restaurant)
        .filter((restaurant): restaurant is Restaurant => !!restaurant);
      const firstRestaurant = planRestaurants[0];
      this.setData({
        trip: { ...this.data.trip, currentPlan: result.plan },
        restaurants: planRestaurants,
        rankedRestaurants: [],
        candidateGroups,
        debugConstraints: result.constraints,
        debugPlanVersion: result.plan.version,
        debugConflictCount: result.plan.conflicts.length,
        debugUnresolved: result.unresolvedCommentIds,
        'debugProvider.searchQuery': this.buildSearchQuery(result.constraints),
        'debugProvider.rawResultCount': planRestaurants.length,
        'debugProvider.selectedEntity': firstRestaurant?.name ?? '',
        'debugProvider.providerRefs': firstRestaurant?.providerRefs?.map((p) => `${p.provider}:${p.externalId}`) ?? [],
        'debugProvider.externalActions': firstRestaurant?.externalActions?.length ?? 0,
      });
      return;
    }

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

    // 计划刚生成出第一个地点时，解除「行程未生成」拦截（面板正开着才重算，避免无谓请求）；
    // 重算后因尚未选出发地点，会落到「请选择出发地点」选点面板，不会自动调用。
    if (this.data.showRoute && this.data.routeBlockReason === 'NO_FIRST_LOCATION') {
      this.loadRouteOptions();
    }
  },

  /** 从 DINING 约束值提取餐饮关键词（Debug 展示用；缺省「餐厅」） */
  extractDiningKeywordFromConstraint(constraint: Constraint | undefined): string {
    if (!constraint) return '餐厅';
    const value = constraint.value as Record<string, unknown>;
    const candidate = value.keyword ?? value.category ?? value.note;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    return '餐厅';
  },

  /** 从约束构建 Provider 搜索查询（Debug 展示用） */
  buildSearchQuery(constraints: Constraint[]): string {
    const dining = constraints.find((c) => c.scope === 'DINING');
    const district = constraints.find((c) => c.type === 'LOCATION')?.value.district as string | undefined;
    const keyword = this.extractDiningKeywordFromConstraint(dining);
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
    // 示例行程守卫：一切写后端动作直接明确提示，不发真实请求
    const blockedMessage = guardDemoTripWrite(this.data.trip.id);
    if (blockedMessage) {
      wx.showToast({ title: blockedMessage, icon: 'none' });
      return;
    }

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

  /**
   * 删除行程入口：圆形垃圾桶按钮（仅 owner 显示）。示例行程守卫 + 登录态守卫后走统一流程
   * （权限/二次确认/防重复在 utils/trip-delete.ts）。硬删除不可恢复：
   * real 模式失败真实抛错——仅 toast 错误信息、留在本页可重试，绝不本地假装删除。
   */
  onDeleteTripTap() {
    // 示例行程守卫：一切写后端动作直接明确提示，不发真实请求
    const blockedMessage = guardDemoTripWrite(this.data.trip.id);
    if (blockedMessage) {
      wx.showToast({ title: blockedMessage, icon: 'none' });
      return;
    }

    // 登录态守卫：无 currentUser 时禁止操作，绝不回退到 Mock 用户
    const app = getApp<IAppOption>();
    const guard = requireCurrentUser(app.globalData.currentUser);
    if (!guard.ok) {
      wx.showToast({ title: '登录状态失效，请重新登录', icon: 'none' });
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    runDeleteTripFlow({
      permission: resolveDeleteTripPermission(
        this.data.trip,
        guard.user,
        this.data.isDeletingTrip
      ),
      confirm: () =>
        new Promise<boolean>((resolve) =>
          wx.showModal({
            ...buildDeleteTripModal(),
            success: (res) => resolve(!!res.confirm),
            fail: () => resolve(false),
          })
        ),
      remove: () => {
        this.setData({ isDeletingTrip: true });
        return tripService.deleteTrip(this.data.trip.id);
      },
      onSuccess: () => {
        // 清理页面本地状态后离开：首页 onShow 会重新拉取真实 Trip list
        this.setData({ isDeletingTrip: false });
        wx.showToast({ title: '行程已删除', icon: 'success' });
        setTimeout(() => wx.switchTab({ url: '/pages/home/home' }), 1500);
      },
      onError: (error) => {
        this.setData({ isDeletingTrip: false });
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
    // 懒加载：首次打开「我的推荐」才评估状态（缺首地点拦截 / 选点面板 / 规划）；
    // 失败后保留错误态，由「重新规划」显式重试。
    if (
      nextShow &&
      !this.data.routesLoaded &&
      !this.data.routeLoading &&
      !this.data.routeErrorText
    ) {
      this.loadRouteOptions();
    }
  },

  /**
   * 「我的推荐」加载链。
   *
   * 门禁（utils/personal-route.ts）现在【仅要求计划第一个地点已就绪】才允许规划：
   * - 缺首地点 → 「行程未生成」直接 return，绝不发起任何路线请求；
   * - 首地点已就绪但本会话还没选出发地点 → 【不自动调用】，面板初开为
   *   「请选择出发地点」两个按钮（使用保存地点 / 地图选点），由用户显式选点
   *   （onUseSavedDeparture / onPickDepartureOnMap）后再进入规划分支；
   * - 已选定出发点 → 真实行程走 routeOptionService（腾讯 direction v1，已启用）；
   *   示例行程走 MockRouteOptionService（固化广州 fixture，不消费 query、永不触达腾讯 API）。
   */
  async loadRouteOptions(): Promise<void> {
    const isDemo = isDemoTripId(this.data.trip.id);

    // 门禁：只要求首地点；出发地点从硬前提降级为「使用保存地点」候选（可为空）
    const gate = resolvePersonalRouteGate({
      departurePlaces: loadDeparturePlaces(),
      plan: this.data.trip.currentPlan,
    });
    if (!gate.ok) {
      this.setData({
        routeOptions: [],
        routeResolvedDestination: null,
        routesLoaded: false,
        routeLoading: false,
        routeErrorText: gate.message,
        routeBlockReason: gate.reason,
        routeNeedsOrigin: false,
        routeDestinationName: '',
      });
      return;
    }

    // 首地点已就绪但尚未选出发地点：不自动调用——面板初开为「请选择出发地点」两个按钮
    if (!this.data.routeOrigin) {
      this.setData({
        routeOptions: [],
        routeResolvedDestination: null,
        routesLoaded: false,
        routeLoading: false,
        routeErrorText: '',
        routeBlockReason: '',
        routeNeedsOrigin: true,
        routeDestinationName: gate.destinationName,
        savedDeparture: gate.origin?.place ?? null,
      });
      return;
    }

    // 已选定出发地点 → 发起规划
    const query: RoutePlanQuery = isDemo
      ? // 示例行程：目的地名仅作语义占位，Mock fixture 固定返回广州羽毛球中心路线，不读这个值
        { destinationName: gate.destinationName }
      : {
          // 起点为本会话选定的出发点（使用保存地点 / 地图选点，不请求设备定位），终点为计划第一个地点；
          // city 取行程自身的区域约束，缺省由 Provider 用默认城市检索。
          origin: {
            latitude: this.data.routeOrigin.latitude,
            longitude: this.data.routeOrigin.longitude,
          },
          destinationName: gate.destinationName,
          ...(this.data.trip.areaConstraint?.city
            ? { city: this.data.trip.areaConstraint.city }
            : {}),
        };

    const service = isDemo ? demoRouteOptionService : routeOptionService;
    this.setData({ routeLoading: true, routeErrorText: '', routeBlockReason: '', routeNeedsOrigin: false });
    try {
      const result = await service.planRoutes(query);
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

  /** 「请选择出发地点」按钮 1：使用已保存的默认出发地点；未保存时引导去「出发设置」 */
  onUseSavedDeparture() {
    const origin = resolveDefaultDeparturePlace(loadDeparturePlaces());
    if (!origin) {
      wx.showToast({ title: '还没有保存的出发地点', icon: 'none' });
      wx.navigateTo({ url: '/pages/departure-places/departure-places' });
      return;
    }
    this.setData({ routeOrigin: origin });
    this.loadRouteOptions();
  },

  /** 「请选择出发地点」按钮 2：地图选点；选中的点同时保存为默认出发地点，供下次「使用保存地点」一键复用 */
  onPickDepartureOnMap() {
    wx.chooseLocation({
      success: (res) => {
        const place = buildDeparturePlace({
          name: res.name,
          address: res.address,
          latitude: res.latitude,
          longitude: res.longitude,
        });
        saveDeparturePlaces(mergeDeparturePlace(loadDeparturePlaces(), place));
        const point = resolveDefaultDeparturePlace([place]);
        if (!point) return; // buildDeparturePlace 保证坐标有限，此处仅做类型收窄
        this.setData({ routeOrigin: point });
        this.loadRouteOptions();
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '打开地图失败，请检查定位授权', icon: 'none' });
      },
    });
  },

  /** 组件 toggle 事件：手风琴状态机（utils/route-options-ui.ts）——最多一条展开，点已展开项全部收起 */
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

  /** 「重新规划」：清空已加载路线后重走加载链（缺首地点时重走会回到拦截态，由面板新状态接管） */
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

    const tripId = this.data.trip.id;

    // 示例行程：纯本地展示（不请求后端、不持久化），保持开箱即用
    if (isDemoTripId(tripId)) {
      const demoComment: Comment = buildUserComment(tripId, text, guard.user);
      this.setData({
        comments: [...this.data.comments, demoComment],
        inputText: '',
        commentCount: this.data.commentCount + 1,
      });
      this.runPipeline([demoComment]);
      return;
    }

    // 真实行程：乐观提交（临时 id 本地回显）→ 服务端确认后按 id 替换合并；
    // 失败回滚乐观项并明确提示——绝不本地假装多人评论已持久化。
    const tempId = createTempCommentId();
    const optimistic: Comment = {
      id: tempId,
      tripId,
      userId: guard.user.id,
      rawText: text,
      createdAt: new Date().toISOString(),
      aiStatus: 'processing',
      aiSource: 'none',
      author: {
        id: guard.user.id,
        nickname: guard.user.nickname,
        avatarUrl: guard.user.avatarUrl ?? '',
      },
    };
    this.setData({
      comments: [...this.data.comments, optimistic],
      inputText: '',
      commentCount: this.data.commentCount + 1,
    });
    this.runPipeline(this.data.comments);

    commentService.addComment(tripId, text).then(
      (serverComment) => {
        // 服务端返回为最终真相：替换本地待确认临时项，绝不整体覆盖评论集合
        const merged = commitServerComment(this.data.comments, serverComment);
        this.setData({ comments: merged, commentCount: merged.length });
        this.runPipeline(merged);
        // 首条 usable 评论可能已在服务端生成首版行程：拉一次让它可见
        this.refreshGeneratedPlan(tripId);
      },
      (error) => {
        // 发送失败：移除本地乐观项，保留其余评论，明确提示
        const rollback = this.data.comments.filter((c) => c.id !== tempId);
        this.setData({ comments: rollback, commentCount: rollback.length });
        wx.showToast({ title: '评论发送失败', icon: 'none' });
      }
    );
  },

  /**
   * 评论提交成功后拉取服务端最新行程（AI Trip Pipeline V2 Stage 2 / Stage 3）。
   *
   * 服务端可能在本次评论后：生成首版（无计划 → v1）或更新计划（vN → vN+1）。
   * 因此按**版本号**决定是否采纳：仅当服务端版本更新时替换本地计划，
   * 绝不用旧版本覆盖新版本。计划是否变化完全由服务端 pipeline 决定，
   * 前端不根据评论文本做任何推断。
   * 失败静默保留当前状态，绝不伪造计划。
   */
  async refreshGeneratedPlan(tripId: string): Promise<void> {
    if (isDemoTripId(tripId)) return;
    try {
      const trip = await tripService.getTrip(tripId);
      const serverPlan = trip?.currentPlan;
      if (!serverPlan || serverPlan.events.length === 0) return;

      const localVersion = this.data.trip.currentPlan?.version ?? 0;
      if (serverPlan.version <= localVersion) return;

      const nextTrip = {
        ...this.data.trip,
        currentPlan: serverPlan,
        latestAIUI: trip?.latestAIUI,
      };
      this.setData({ trip: nextTrip });
      this.applyAIUIState(nextTrip);
      this.runPipeline(this.data.comments);
    } catch {
      // 尚未生成/更新或网络失败：保留当前状态，等待下次进入页面刷新
    }
  },

  /**
   * 消费服务端下发的 AI UI 语义配置。
   * 只做语义 → ViewModel 的整理；颜色、字体、动画等视觉表现由 WXML / WXSS 决定。
   */
  applyAIUIState(trip: Trip): void {
    const aiUI = resolveAIUIViewModel(trip);
    this.setData({
      aiUI: aiUI.isCurrent ? aiUI : null,
      aiEventFlags: buildEventUIFlags(trip.currentPlan, aiUI),
    });
  },

  onPlaceTap(e: WechatMiniprogram.CustomEvent) {
    const location = e.detail.location;
    if (!location) return;
    // 直接携带实体数据跳转，避免详情页依赖本地 mock 表回查
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?kind=location&entity=${encodeURIComponent(
        JSON.stringify(location),
      )}`,
    });
  },

  onRestaurantTap(e: WechatMiniprogram.CustomEvent) {
    const restaurant = e.detail.restaurant;
    if (!restaurant) return;
    // 直接携带实体数据跳转，避免详情页依赖本地 mock 表回查
    wx.navigateTo({
      url: `/pages/place-detail/place-detail?kind=restaurant&entity=${encodeURIComponent(
        JSON.stringify(restaurant),
      )}`,
    });
  },

  // ---- Debug 面板 ----
  onDebugToggle() {
    this.setData({ debugExpanded: !this.data.debugExpanded });
  },

  onDebugReset() {
    if (!this.engine || !this.initialSnapshot) return;
    const snapshot = this.initialSnapshot;
    this.engine.reset();
    const snapshotPlan = snapshot.trip.currentPlan ?? buildEmptyPlan(snapshot.trip.id);
    const snapshotRestaurants = buildEventCandidateGroups(snapshotPlan, [])
      .flatMap((group) => group.candidates)
      .map((candidate) => candidate.restaurant)
      .filter((restaurant): restaurant is Restaurant => !!restaurant);
    this.setData({
      comments: snapshot.comments,
      trip: { ...this.data.trip, currentPlan: snapshotPlan },
      restaurants: snapshotRestaurants,
      rankedRestaurants: [],
      candidateGroups: buildEventCandidateGroups(snapshotPlan, []),
      debugConstraints: [],
      debugPlanVersion: 0,
      debugConflictCount: 0,
      debugUnresolved: [],
    });
  },
});
