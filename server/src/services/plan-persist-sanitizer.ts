// plan-persist-sanitizer.ts
// 最终落库前的确定性不变量门（fail-closed）。
//
// 目的：即使确定性后处理（post-processor）失败或未运行，也绝不允许
// 未经验证的 AI 事实字段绕过验证进入最终 TripPlan 并落库。
//
// 强制不变量：
//   - no runtime mock restaurant：restaurant 必须来自已验证 Provider（providerRefs 含 tencent + externalId），
//     否则一律置为 undefined。
//   - no unverified resolved POI：location 必须来自已验证 Provider，否则置为 undefined。
//   - no AI-generated restaurant factual data：rating / averagePrice / openingHours 仅当
//     Provider 真实返回时存在；本门禁会剥离任何非 Provider 来源的此类字段。
//   - no current-clock-derived trip datetime：活动时间必须锚定到 trip.startDate，
//     禁止把生成时刻的当前日期/时间写入。
//
// 本模块是纯函数，便于确定性测试。

import { TripPlan, TripPlanEvent } from '../types/trip-plan';

/** 判定 location 是否来自已验证 Provider（腾讯 POI） */
function isVerifiedLocation(location: TripPlanEvent['location']): boolean {
  if (!location) return false;
  if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') return false;
  if (!Array.isArray(location.providerRefs)) return false;
  return location.providerRefs.some(
    (ref) => ref.provider === 'tencent' && typeof ref.externalId === 'string' && ref.externalId.length > 0,
  );
}

/** 只复制 Provider 验证后的白名单 factual fields；空白 address 视为缺失。 */
function sanitizeVerifiedLocation(
  location: TripPlanEvent['location'],
): NonNullable<TripPlanEvent['location']> | undefined {
  if (!location || !isVerifiedLocation(location)) return undefined;
  const providerRefs = location.providerRefs!.filter(
    (ref) => ref.provider === 'tencent'
      && typeof ref.externalId === 'string'
      && ref.externalId.length > 0,
  );
  const address = typeof location.address === 'string' ? location.address.trim() : '';
  return {
    id: location.id,
    name: location.name,
    latitude: location.latitude,
    longitude: location.longitude,
    ...(address ? { address } : {}),
    providerRefs,
  };
}

/** 判定 restaurant 是否来自已验证 Provider（腾讯） */
function isVerifiedRestaurant(restaurant: TripPlanEvent['restaurant']): boolean {
  if (!restaurant) return false;
  if (!Array.isArray(restaurant.providerRefs)) return false;
  const verified = restaurant.providerRefs.some(
    (ref) => ref.provider === 'tencent' && typeof ref.externalId === 'string' && ref.externalId.length > 0,
  );
  if (!verified) return false;
  // 内部 location 也必须已验证
  return isVerifiedLocation(restaurant.location);
}

/** 判定时间是否锚定到行程开始日期（禁止当前时钟污染） */
function isAnchoredToTripStart(time: TripPlanEvent['time'], startDate: string): boolean {
  if (!time?.start) return false;
  const startDay = time.start.slice(0, 10);
  return startDay === startDate;
}

/** 清洗单个真实餐厅候选（与 restaurant 同一验证规则，供 restaurantCandidates 使用） */
function sanitizeRestaurantCandidate(
  candidate: NonNullable<TripPlanEvent['restaurantCandidates']>[number],
): NonNullable<TripPlanEvent['restaurantCandidates']>[number] | undefined {
  if (!isVerifiedRestaurant(candidate)) return undefined;
  const candidateLocation = sanitizeVerifiedLocation(candidate.location);
  if (!candidateLocation) return undefined;
  return {
    id: candidate.id,
    name: candidate.name,
    location: candidateLocation,
    ...(typeof candidate.distanceMeters === 'number'
      ? { distanceMeters: candidate.distanceMeters }
      : {}),
    ...(candidate.rating && typeof candidate.rating.score === 'number'
      ? { rating: { score: candidate.rating.score } }
      : {}),
    ...(candidate.averagePrice && typeof candidate.averagePrice.amount === 'number'
      ? { averagePrice: candidate.averagePrice }
      : {}),
    providerRefs: candidate.providerRefs,
  };
}

/** 判定 route 是否来自已验证 Provider 且带有限正数 duration（fail-closed，绝不允许伪造 travel） */
function sanitizeRoute(
  route: TripPlanEvent['route'],
): NonNullable<TripPlanEvent['route']> | undefined {
  if (!route) return undefined;
  if (route.provider !== 'tencent') return undefined;
  if (typeof route.durationMinutes !== 'number' || !Number.isFinite(route.durationMinutes) || route.durationMinutes <= 0) {
    return undefined;
  }
  if (typeof route.fromEventId !== 'string' || route.fromEventId.length === 0) return undefined;
  return {
    fromEventId: route.fromEventId,
    durationMinutes: route.durationMinutes,
    ...(typeof route.distanceMeters === 'number' && Number.isFinite(route.distanceMeters)
      ? { distanceMeters: route.distanceMeters }
      : {}),
    mode: route.mode,
    provider: 'tencent',
  };
}

/**
 * 对单个事件做 fail-closed 清洗：
 *   - 保留意图文本（title / locationRequirement / alternatives / sequenceConstraint）
 *   - 剥离未验证的 location / restaurant / restaurantCandidates / route 及其中任何 AI 事实字段
 *   - 时间未锚定到行程日期时，剥离时间（保留意图，不落库未验证时间）
 */
function sanitizeEvent(
  event: TripPlanEvent,
  tripStartDate: string | undefined,
): TripPlanEvent {
  // 时间：必须锚定到行程日期，否则剥离（fail-closed，不落未验证时间）。
  // 注意：time 在类型上是必填，但落库时若未锚定则置为 undefined（运行时可选）。
  const timeAnchored = !tripStartDate || isAnchoredToTripStart(event.time, tripStartDate);

  const sanitized: TripPlanEvent = {
    id: event.id,
    type: event.type,
    title: event.title,
    time: timeAnchored ? event.time : (undefined as unknown as TripPlanEvent['time']),
    ...(event.locationRequirement ? { locationRequirement: event.locationRequirement } : {}),
    ...(event.alternatives ? { alternatives: event.alternatives } : {}),
    ...(event.sequenceConstraint ? { sequenceConstraint: event.sequenceConstraint } : {}),
  };

  // location：仅保留已验证 Provider 的真实地点
  const verifiedLocation = sanitizeVerifiedLocation(event.location);
  if (verifiedLocation) {
    sanitized.location = verifiedLocation;
  }

  // restaurant：仅保留已验证 Provider 的真实餐厅；其 rating/avgPrice 仅当 Provider 返回
  const restaurant = event.restaurant;
  if (restaurant && isVerifiedRestaurant(restaurant)) {
    const restaurantLocation = sanitizeVerifiedLocation(restaurant.location);
    if (!restaurantLocation) return sanitized;
    sanitized.restaurant = {
      id: restaurant.id,
      name: restaurant.name,
      location: restaurantLocation,
      ...(typeof restaurant.distanceMeters === 'number'
        ? { distanceMeters: restaurant.distanceMeters }
        : {}),
      // truth-preserving：仅保留 Provider 真实返回的 rating / averagePrice
      ...(restaurant.rating && typeof restaurant.rating.score === 'number'
        ? { rating: { score: restaurant.rating.score } }
        : {}),
      ...(restaurant.averagePrice && typeof restaurant.averagePrice.amount === 'number'
        ? { averagePrice: restaurant.averagePrice }
        : {}),
      providerRefs: restaurant.providerRefs,
    };
  }

  // restaurantCandidates：仅保留已验证 Provider 的真实候选
  if (Array.isArray(event.restaurantCandidates) && event.restaurantCandidates.length > 0) {
    const verifiedCandidates = event.restaurantCandidates
      .map(sanitizeRestaurantCandidate)
      .filter((candidate): candidate is NonNullable<TripPlanEvent['restaurantCandidates']>[number] => candidate !== undefined);
    if (verifiedCandidates.length > 0) {
      sanitized.restaurantCandidates = verifiedCandidates;
    }
  }

  // route：仅保留腾讯 direction 真实返回的路线段
  const verifiedRoute = sanitizeRoute(event.route);
  if (verifiedRoute) {
    sanitized.route = verifiedRoute;
  }

  return sanitized;
}

/**
 * 对最终 TripPlan 执行落库前不变量门禁。
 * 返回清洗后的 plan（不修改入参）。
 */
export function sanitizePlanForPersist(
  plan: TripPlan,
  tripStartDate: string | undefined,
): TripPlan {
  return {
    ...plan,
    events: plan.events.map((event) => sanitizeEvent(event, tripStartDate)),
  };
}
