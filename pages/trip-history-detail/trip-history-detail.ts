// pages/trip-history-detail/trip-history-detail.ts
// 历史详情页：封板版本，只读，复用 trip-detail 的展示组件。

import { mockHistoryTrip } from '../../mock/mock-trip';
import { mockComments } from '../../mock/mock-comments';
import { mockRestaurants } from '../../mock/mock-restaurants';
import { mockPersonalRoute, mockRouteSegments } from '../../mock/mock-routes';
import { Comment } from '../../types/comment';
import { Trip } from '../../types/trip';
import { rankCandidates } from '../../core/candidate-ranker';
import { EventCandidateGroup } from '../../types/event-candidate';
import { buildEventCandidateGroups } from '../../utils/event-candidates';
import { hydrateRouteOwner, hydrateTripWithCurrentUser } from '../../utils/current-user';
import { tripService } from '../../services/index';
import { Plan } from '../../types/plan';

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
    trip: mockHistoryTrip as Trip,
    comments: mockComments as Comment[],
    restaurants: mockRestaurants,
    candidateGroups: [] as EventCandidateGroup[],
    route: mockPersonalRoute,
    routeSegments: mockRouteSegments,
    completedText: '',
    participantCount: 0,
  },

  onLoad(options?: Record<string, string | undefined>) {
    const app = getApp<IAppOption>();
    const currentUser = app.globalData.currentUser;
    const requestedTripId = options?.tripId;
    if (requestedTripId) {
      tripService
        .getTrip(requestedTripId)
        .then((trip) => {
          if (!trip) {
            this.handleTripUnavailable('行程不存在');
            return;
          }
          this.bootstrapTrip(trip, false);
        })
        .catch(() => this.handleTripUnavailable('行程加载失败'));
      return;
    }

    // 无 tripId 时保留旧 Mock Demo 入口。
    this.bootstrapTrip(hydrateTripWithCurrentUser(mockHistoryTrip, currentUser), true);
  },

  bootstrapTrip(baseTrip: Trip, seedDemoData: boolean) {
    const currentUser = getApp<IAppOption>().globalData.currentUser;
    const hydratedTrip = hydrateTripWithCurrentUser(baseTrip, currentUser);
    const trip = hydratedTrip.currentPlan
      ? hydratedTrip
      : { ...hydratedTrip, currentPlan: buildEmptyPlan(hydratedTrip.id) };
    const completedAt = trip.completedAt ?? '';
    const restaurants = seedDemoData ? mockRestaurants : [];
    const comments = seedDemoData ? mockComments : [];
    const rankedRestaurants = rankCandidates({ restaurants, constraints: [] });
    this.setData({
      trip,
      comments,
      restaurants,
      route: hydrateRouteOwner(mockPersonalRoute, currentUser),
      completedText: completedAt ? completedAt.slice(0, 16).replace('T', ' ') : '',
      participantCount: trip.participantIds.length,
      candidateGroups: buildEventCandidateGroups(trip.currentPlan, rankedRestaurants),
    });
  },

  handleTripUnavailable(message: string) {
    wx.showToast({ title: message, icon: 'none' });
    setTimeout(() => wx.navigateBack(), 800);
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
});
