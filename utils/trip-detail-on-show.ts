import { isDemoTripId } from './demo-trip';

export interface TripDetailOnShowState {
  tripId: string;
  showRoute: boolean;
  routeLoading: boolean;
  routeBlockReason: string;
  routeNeedsOrigin: boolean;
}

export interface TripDetailOnShowActions {
  refreshComments: boolean;
  loadRouteOptions: boolean;
}

/** 评论与路线是独立生命周期；路线门禁永远不能取消真实评论刷新。 */
export function resolveTripDetailOnShowActions(
  state: TripDetailOnShowState,
): TripDetailOnShowActions {
  return {
    refreshComments: !isDemoTripId(state.tripId),
    loadRouteOptions:
      state.showRoute
      && !state.routeLoading
      && (!!state.routeBlockReason || state.routeNeedsOrigin),
  };
}
