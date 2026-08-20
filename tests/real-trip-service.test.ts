// RealTripService 请求语义测试：认证、server-owned 字段边界与失败行为。

import { authConfig } from '../config/auth';
import {
  RealTripService,
  RealTripServiceError,
} from '../services/real/real-trip-service';
import { Trip } from '../types/trip';

interface TestRequestOption {
  url: string;
  method?: string;
  data?: unknown;
  header?: Record<string, string>;
  success?: (response: WechatMiniprogram.RequestSuccessCallbackResult) => void;
  fail?: (error: WechatMiniprogram.GeneralCallbackResult) => void;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
}

async function expectReject(
  operation: () => Promise<unknown>,
  predicate: (error: RealTripServiceError) => boolean,
  message: string
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof RealTripServiceError && predicate(error), message);
    return;
  }
  throw new Error(`断言失败: ${message}`);
}

function installWx(
  responder: (option: TestRequestOption) => void,
  token = 'test-token'
): TestRequestOption[] {
  const requests: TestRequestOption[] = [];
  const testWx = {
    getStorageSync: () => token,
    request: (option: TestRequestOption) => {
      requests.push(option);
      responder(option);
    },
  };
  (globalThis as unknown as { wx: WechatMiniprogram.Wx }).wx =
    testWx as unknown as WechatMiniprogram.Wx;
  return requests;
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip_123',
    title: '顺德一日游',
    status: 'ACTIVE',
    creatorId: 'usr_123',
    participantIds: ['usr_123'],
    createdAt: '2026-08-20T10:00:00.000Z',
    initialBrief: '周末去顺德吃东西',
    commentIds: [],
    constraintIds: [],
    ...overrides,
  };
}

function succeed(option: TestRequestOption, data: unknown, statusCode = 200): void {
  option.success?.({
    data,
    statusCode,
    header: {},
    cookies: [],
    errMsg: 'request:ok',
    profile: {},
  } as unknown as WechatMiniprogram.RequestSuccessCallbackResult);
}

export async function runRealTripServiceTests(): Promise<void> {
  const service = new RealTripService();

  const createRequests = installWx((option) => succeed(option, { trip: tripFixture() }, 201));
  await service.createTrip({
    title: '顺德一日游',
    creatorId: 'malicious-client-owner',
    initialBrief: '周末去顺德吃东西',
    areaConstraint: { unrestricted: true },
  });
  const create = createRequests[0];
  const createBody = create.data as Record<string, unknown>;
  assert(create.method === 'POST', 'createTrip 应使用 POST');
  assert(create.url === `${authConfig.baseUrl}/trips`, 'createTrip URL 应为 /trips');
  assert(create.header?.Authorization === 'Bearer test-token', '请求必须携带 Bearer token');
  assert(!('creatorId' in createBody), 'create body 不得包含 creatorId');
  assert(!('participantIds' in createBody), 'create body 不得包含 participantIds');
  assert(!('status' in createBody), 'create body 不得包含 status');

  const listRequests = installWx((option) => succeed(option, { trips: [] }));
  await service.listActiveTrips();
  await service.listHistoryTrips();
  assert(listRequests[0].url.endsWith('/trips?status=ACTIVE'), 'active list 必须过滤 ACTIVE');
  assert(listRequests[1].url.endsWith('/trips?status=COMPLETED'), 'history list 必须过滤 COMPLETED');

  installWx((option) =>
    succeed(option, { error: { code: 'TRIP_NOT_FOUND', message: '行程不存在' } }, 404)
  );
  assert((await service.getTrip('missing')) === null, 'getTrip 404 应返回 null');

  installWx((option) =>
    succeed(option, { error: { code: 'AUTH_UNAUTHORIZED', message: '未登录' } }, 401)
  );
  await expectReject(
    () => service.listActiveTrips(),
    (error) => error.statusCode === 401 && error.code === 'AUTH_UNAUTHORIZED',
    '401 必须明确抛出且不得回退 Mock'
  );

  installWx((option) => option.fail?.({ errMsg: 'request:fail timeout' }));
  await expectReject(
    () => service.listActiveTrips(),
    (error) => error.code === 'TRIP_NETWORK_ERROR',
    '网络错误必须明确抛出且不得回退 Mock'
  );

  console.log('✅ real-trip-service.test.ts 全部通过');
}
