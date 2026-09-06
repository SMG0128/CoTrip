import { TripPlan, TripPlanEvent } from '../types/trip-plan';

export function isVerifiedPlace(place: TripPlanEvent['location']): place is NonNullable<TripPlanEvent['location']> {
  return !!place && !!place.id?.trim() && !!place.name?.trim()
    && !/^(附近.*|市中心|酒店附近|午餐|晚餐|餐厅|粤菜餐厅|自由活动|找一家.*)$/.test(place.name)
    && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90
    && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    && !!place.providerRefs?.some(ref => ref.provider === 'tencent' && ref.externalId === place.id);
}

export function samePlace(a: TripPlanEvent['location'], b: TripPlanEvent['location']): boolean {
  return isVerifiedPlace(a) && isVerifiedPlace(b) && a.id === b.id
    && a.latitude === b.latitude && a.longitude === b.longitude;
}

/** 正式可执行性门禁。未解决的意图保留为 needs_attention，不能冒充成功行程。 */
export function validateItinerary(plan: TripPlan, dates?: { start?: string; end?: string }): TripPlan {
  const issues: NonNullable<TripPlan['validationIssues']> = [];
  const ids = new Set<string>();
  const events = plan.events.map((source, index) => {
    const event = { ...source };
    const issue = (code: string): void => { issues.push({ eventId: event.id, code }); };
    if (ids.has(event.id)) issue('DUPLICATE_ACTIVITY_ID');
    ids.add(event.id);
    const place = event.restaurant?.location ?? event.location;
    event.locationStatus = isVerifiedPlace(place) ? 'resolved'
      : event.locationStatus === 'search_unavailable' ? 'search_unavailable' : 'unresolved';
    if (event.type !== 'TRANSPORT' && event.locationStatus !== 'resolved') issue('PLACE_UNRESOLVED');
    const start = Date.parse(event.time?.start);
    const end = Date.parse(event.time?.end ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) issue('TIME_INVALID');
    if ((dates?.start && (event.time?.start?.slice(0, 10) ?? '') < dates.start)
      || (dates?.end && (event.time?.end?.slice(0, 10) ?? '') > dates.end)) issue('TIME_OUTSIDE_TRIP');
    const previous = plan.events[index - 1];
    const sameDay = previous && previous.time?.start?.slice(0, 10) === event.time?.start?.slice(0, 10);
    const origin = previous?.restaurant?.location ?? previous?.location;
    const route = event.route;
    const validRoute = !!route && !!sameDay && route.provider === 'tencent'
      && ['walking', 'transit', 'driving'].includes(route.mode)
      && Number.isFinite(route.durationMinutes) && route.durationMinutes > 0
      && (route.distanceMeters === undefined || (Number.isFinite(route.distanceMeters) && route.distanceMeters >= 0))
      && route.fromEventId === previous.id && route.toEventId === event.id
      && samePlace(route.origin, origin) && samePlace(route.destination, place)
      && (!event.transportPreference || route.mode === event.transportPreference);
    if (route && !validRoute) { delete event.route; issue('ROUTE_INCONSISTENT'); }
    event.routeStatus = !sameDay ? 'not_required' : validRoute ? 'resolved'
      : !isVerifiedPlace(origin) || !isVerifiedPlace(place) ? 'unresolved' : 'unavailable';
    if (sameDay && event.routeStatus !== 'resolved') issue('ROUTE_UNAVAILABLE');
    if (sameDay && Number.isFinite(start)) {
      const earliest = Date.parse(previous.time?.end ?? previous.time?.start)
        + (validRoute ? route!.durationMinutes * 60000 : 0);
      if (start < earliest) issue('TIME_CONFLICT');
    }
    return event;
  });
  if (!events.length) issues.push({ eventId: '', code: 'EMPTY_ITINERARY' });
  return { ...plan, events, status: issues.length ? 'needs_attention' : 'actionable', validationIssues: issues };
}
