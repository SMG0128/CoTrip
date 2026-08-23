import { Participant } from '../types/participant';
import { Trip } from '../types/trip';
import { isValidRoomCode, normalizeRoomCode } from './room-code';

export interface JoinActionDependencies {
  roomCode: string;
  currentUser: Participant | null;
  joinTrip: (roomCode: string) => Promise<Trip>;
  savePending: (roomCode: string) => void;
  clearPending: () => void;
  goToLogin: () => void;
  goToTripDetail: (tripId: string) => void;
}

export type JoinActionResult = 'LOGIN_REQUIRED' | 'JOINED';

/**
 * 统一加入动作：未登录只保存上下文并去登录；已登录必须等待 service 返回 Trip 才导航。
 */
export async function runJoinAction(
  dependencies: JoinActionDependencies
): Promise<JoinActionResult> {
  const roomCode = normalizeRoomCode(dependencies.roomCode);
  if (!isValidRoomCode(roomCode)) throw new Error('INVALID_ROOM_CODE');

  if (!dependencies.currentUser) {
    dependencies.savePending(roomCode);
    dependencies.goToLogin();
    return 'LOGIN_REQUIRED';
  }

  const trip = await dependencies.joinTrip(roomCode);
  dependencies.clearPending();
  dependencies.goToTripDetail(trip.id);
  return 'JOINED';
}

export type LoginContinuation =
  | { kind: 'join'; url: string }
  | { kind: 'home'; url: '/pages/home/home' };

/** 登录后只返回邀请落地页，不自动执行 join。 */
export function resolveLoginContinuation(
  pendingRoomCode: string | null
): LoginContinuation {
  const roomCode = normalizeRoomCode(pendingRoomCode);
  if (isValidRoomCode(roomCode)) {
    return {
      kind: 'join',
      url: `/pages/join-trip/join-trip?roomCode=${encodeURIComponent(roomCode)}`,
    };
  }
  return { kind: 'home', url: '/pages/home/home' };
}
