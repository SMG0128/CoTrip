// 个人路线门禁：只有计划存在真实首地点时才允许进入路线选点/规划链路。

import { Plan } from '../types/plan';
import { DeparturePlace } from './departure-places';

export type PersonalRouteBlockReason = 'NO_FIRST_LOCATION';

export interface DeparturePoint {
  latitude: number;
  longitude: number;
  place: DeparturePlace;
}

export function resolveDefaultDeparturePlace(
  places: DeparturePlace[],
): DeparturePoint | null {
  const place = places.find((candidate) => candidate.isDefault) ?? places[0];
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  return { latitude: place.latitude!, longitude: place.longitude!, place };
}

export type PersonalRouteGate =
  | {
      ok: false;
      reason: PersonalRouteBlockReason;
      message: string;
    }
  | {
      ok: true;
      destinationName: string;
      origin: DeparturePoint | null;
    };

export function resolvePersonalRouteGate(input: {
  departurePlaces: DeparturePlace[];
  plan?: Plan;
}): PersonalRouteGate {
  const firstLocation = input.plan?.events[0]?.location;
  if (!firstLocation?.name) {
    return {
      ok: false,
      reason: 'NO_FIRST_LOCATION',
      message: '行程尚未生成首个地点',
    };
  }
  return {
    ok: true,
    destinationName: firstLocation.name,
    origin: resolveDefaultDeparturePlace(input.departurePlaces),
  };
}
