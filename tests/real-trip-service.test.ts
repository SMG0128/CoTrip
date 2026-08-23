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

  // ---- getJoinPreview：公开预览无需登录，且只暴露最小公开字段 ----
  const previewRequests = installWx(
    (option) =>
      succeed(option, {
        preview: {
          roomCode: '7K4M9XQ',
          title: '顺德一日游',
          participantCount: 1,
          status: 'ACTIVE',
          creatorId: 'server-private-owner',
          participantIds: ['server-private-owner'],
          openid: 'server-private-openid',
        },
      }),
    ''
  );
  const preview = await service.getJoinPreview(' 7k4 m9xq ');
  assert(preview?.roomCode === '7K4M9XQ', 'preview 应返回后端房间码');
  assert(preview?.title === '顺德一日游', 'preview 应返回后端标题');
  assert(preview?.participantCount === 1, 'preview 应返回参与人数');
  assert(preview?.status === 'ACTIVE', 'preview 应返回行程状态');
  assert(preview !== null && !('creatorId' in preview), 'preview 不得暴露 creatorId');
  assert(preview !== null && !('participantIds' in preview), 'preview 不得暴露 participantIds');
  assert(preview !== null && !('openid' in preview), 'preview 不得暴露 openid');
  const previewRequest = previewRequests[0];
  assert(previewRequest.method === 'GET', 'getJoinPreview 应使用 GET');
  assert(
    previewRequest.url === `${authConfig.baseUrl}/trips/join-preview?roomCode=7K4M9XQ`,
    'getJoinPreview URL 应携带规范化 roomCode'
  );
  assert(previewRequest.data === undefined, 'getJoinPreview 不应发送请求体');
  assert(!previewRequest.header?.Authorization, '公开 preview 不应要求或发送 Bearer token');

  installWx(
    (option) =>
      succeed(
        option,
        { error: { code: 'TRIP_NOT_FOUND', message: '未找到对应行程' } },
        404
      ),
    ''
  );
  assert(
    (await service.getJoinPreview('7K4M9XQ')) === null,
    'getJoinPreview 404 应映射为 null'
  );

  installWx(
    (option) =>
      succeed(
        option,
        { error: { code: 'TRIP_PREVIEW_FAILED', message: '预览失败' } },
        500
      ),
    ''
  );
  await expectReject(
    () => service.getJoinPreview('7K4M9XQ'),
    (error) =>
      error.code === 'TRIP_PREVIEW_FAILED' &&
      error.message === '预览失败' &&
      error.statusCode === 500,
    'preview 非 404 错误必须明确抛出且不得回退 Mock'
  );

  // ---- joinTrip：必须认证，请求体只有规范化 roomCode ----
  const joinedFixture = tripFixture({
    participantIds: ['usr_123', 'usr_joined'],
    roomCode: '7K4M9XQ',
  });
  const joinRequests = installWx((option) => succeed(option, { trip: joinedFixture }));
  const joined = await service.joinTrip(' 7k4 m9xq ');
  assert(joined === joinedFixture, 'joinTrip 应返回后端返回的 Trip');
  const joinRequest = joinRequests[0];
  const joinBody = joinRequest.data as Record<string, unknown>;
  assert(joinRequest.method === 'POST', 'joinTrip 应使用 POST');
  assert(joinRequest.url === `${authConfig.baseUrl}/trips/join`, 'joinTrip URL 应为 /trips/join');
  assert(joinRequest.header?.Authorization === 'Bearer test-token', 'joinTrip 必须携带 Bearer token');
  assert(joinBody.roomCode === '7K4M9XQ', 'join body 应携带规范化 roomCode');
  assert(Object.keys(joinBody).length === 1, 'join body 只能包含 roomCode');
  assert(!('creatorId' in joinBody), 'join body 不得包含 creatorId');
  assert(!('participantIds' in joinBody), 'join body 不得包含 participantIds');
  assert(!('userId' in joinBody), 'join body 不得包含 userId');
  assert(!('openid' in joinBody), 'join body 不得包含 openid');
  assert(!('status' in joinBody), 'join body 不得包含 status');

  const unauthenticatedJoinRequests = installWx(() => {
    throw new Error('无 token 时 joinTrip 不应发起 wx.request');
  }, '');
  await expectReject(
    () => service.joinTrip('7K4M9XQ'),
    (error) => error.code === 'AUTH_UNAUTHORIZED' && error.statusCode === 401,
    'joinTrip 无 token 时必须明确抛 AUTH_UNAUTHORIZED'
  );
  assert(unauthenticatedJoinRequests.length === 0, '无 token 时 joinTrip 不得发起请求');

  installWx((option) =>
    succeed(
      option,
      { error: { code: 'TRIP_NOT_JOINABLE', message: '该行程当前不可加入' } },
      409
    )
  );
  await expectReject(
    () => service.joinTrip('7K4M9XQ'),
    (error) =>
      error.code === 'TRIP_NOT_JOINABLE' &&
      error.message === '该行程当前不可加入' &&
      error.statusCode === 409,
    'joinTrip 后端失败必须明确抛出且不得回退 Mock'
  );

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

  // ---- completeTrip：真实接入请求语义 ----
  const completeRequests = installWx((option) =>
    succeed(
      option,
      {
        trip: tripFixture({ status: 'COMPLETED', completedAt: '2026-08-21T10:00:00.000Z' }),
      },
      200
    )
  );
  const completedTrip = await service.completeTrip('trip_123');
  assert(completedTrip.status === 'COMPLETED', 'completeTrip 应返回后端完成的 Trip');
  const complete = completeRequests[0];
  // completeTrip 不携带请求体：data 应为空（无任何客户端伪造的身份/状态字段）
  const completeBody = (complete.data ?? {}) as Record<string, unknown>;
  assert(complete.method === 'POST', 'completeTrip 应使用 POST');
  assert(
    complete.url === `${authConfig.baseUrl}/trips/trip_123/complete`,
    'completeTrip URL 应为 /trips/trip_123/complete'
  );
  assert(complete.header?.Authorization === 'Bearer test-token', '请求必须携带 Bearer token');
  assert(!('creatorId' in completeBody), 'complete body 不得包含 creatorId');
  assert(!('userId' in completeBody), 'complete body 不得包含 userId');
  assert(!('status' in completeBody), 'complete body 不得包含 status');

  installWx((option) =>
    succeed(
      option,
      { error: { code: 'TRIP_STATE_INVALID', message: '行程状态不允许完成' } },
      500
    )
  );
  await expectReject(
    () => service.completeTrip('trip_123'),
    (error) =>
      error.statusCode === 500 &&
      error.code === 'TRIP_STATE_INVALID' &&
      error.message === '行程状态不允许完成',
    '500 必须透传为 RealTripServiceError（code/message/statusCode），失败真实抛出不回退'
  );

  console.log('✅ real-trip-service.test.ts 全部通过');
}
