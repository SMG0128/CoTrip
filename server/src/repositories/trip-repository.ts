import { Trip, TripStatus } from '../types/trip';

export interface TripRepository {
  create(trip: Trip): Promise<Trip>;
  /** 按 id 整体替换存储中的该 Trip 并持久化；id 不存在时作为防御抛 TRIP_NOT_FOUND。 */
  update(trip: Trip): Promise<Trip>;
  findById(id: string): Promise<Trip | null>;
  /** V0.3 Room Identity：通过房间号查询 Trip（Join 能力的前置基础查询）。 */
  findByRoomCode(roomCode: string): Promise<Trip | null>;
  /** 为缺失/非法 roomCode 的历史 Trip 安全补齐房间号，返回补齐数量。 */
  backfillRoomCodes(): Promise<number>;
  listForUser(userId: string, status?: TripStatus): Promise<Trip[]>;
}
