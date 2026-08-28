// RealCommentService 请求语义测试：
// 评论按共享实体（tripId）读写、必须认证、作者身份由服务端注入、失败明确抛出不回退 Mock。

import { appConfig } from '../config/auth';
import {
  RealCommentService,
  RealCommentServiceError,
} from '../services/real/real-comment-service';

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
  predicate: (error: RealCommentServiceError) => boolean,
  message: string
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof RealCommentServiceError && predicate(error), message);
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

export async function runRealCommentServiceTests(): Promise<void> {
  const service = new RealCommentService();

  // ---- listComments：GET 共享实体评论流，必须携带 Bearer token ----
  const listRequests = installWx((option) =>
    succeed(option, {
      comments: [
        {
          id: 'comment_1',
          tripId: 'trip_T',
          userId: 'usr_A',
          rawText: 'A1',
          createdAt: '2026-08-28T10:00:00.000Z',
        },
        {
          id: 'comment_2',
          tripId: 'trip_T',
          userId: 'usr_B',
          rawText: 'B1',
          createdAt: '2026-08-28T10:01:00.000Z',
        },
      ],
    })
  );
  const comments = await service.listComments('trip_T');
  assert(comments.length === 2, 'GET 返回 A1 与 B1（共享实体评论流，不是“我的评论”）');
  assert(
    comments.some((c) => c.rawText === 'A1' && c.userId === 'usr_A'),
    '包含 A 的评论'
  );
  assert(
    comments.some((c) => c.rawText === 'B1' && c.userId === 'usr_B'),
    '包含 B 的评论'
  );
  assert(comments.every((c) => c.aiStatus === 'unresolved'), '后端评论 hydrate 出默认 AI 状态');
  const listRequest = listRequests[0];
  assert(listRequest.method === 'GET', 'listComments 应使用 GET');
  assert(
    listRequest.url === `${appConfig.baseUrl}/trips/trip_T/comments`,
    'listComments URL 应为 /trips/:id/comments'
  );
  assert(
    listRequest.header?.Authorization === 'Bearer test-token',
    '必须携带 Bearer token'
  );
  assert(listRequest.data === undefined, 'GET 不应发送请求体');

  // 空评论流
  installWx((option) => succeed(option, { comments: [] }));
  assert((await service.listComments('trip_T')).length === 0, '空评论流返回空数组');

  // ---- addComment：POST body 只含 rawText，作者身份由服务端认证注入 ----
  const addRequests = installWx((option) =>
    succeed(
      option,
      {
        comment: {
          id: 'comment_9',
          tripId: 'trip_T',
          userId: 'usr_B',
          rawText: 'B1',
          createdAt: '2026-08-28T10:01:00.000Z',
        },
      },
      201
    )
  );
  const created = await service.addComment('trip_T', 'B1');
  assert(created.id === 'comment_9' && created.rawText === 'B1', 'addComment 返回服务端确认的评论');
  assert(created.userId === 'usr_B', '作者身份来自服务端，而非客户端');
  const addRequest = addRequests[0];
  assert(addRequest.method === 'POST', 'addComment 应使用 POST');
  assert(
    addRequest.url === `${appConfig.baseUrl}/trips/trip_T/comments`,
    'addComment URL 应为 /trips/:id/comments'
  );
  const addBody = addRequest.data as Record<string, unknown>;
  assert(addBody.rawText === 'B1', '请求体包含 rawText');
  assert(Object.keys(addBody).length === 1, '请求体只能包含 rawText');
  assert(!('userId' in addBody), '请求体不得包含 userId（作者由服务端注入）');
  assert(!('tripId' in addBody), '请求体不得包含 tripId（路径为准）');

  // ---- 失败行为：401 / 403 / 网络错误 明确抛出，绝不回退 Mock ----
  const unauthenticatedRequests = installWx(() => {
    throw new Error('无 token 时评论请求不应发起');
  }, '');
  await expectReject(
    () => service.listComments('trip_T'),
    (error) => error.code === 'AUTH_UNAUTHORIZED' && error.statusCode === 401,
    '无 token 时必须明确抛 AUTH_UNAUTHORIZED'
  );
  assert(unauthenticatedRequests.length === 0, '无 token 时不得发起请求');

  installWx((option) =>
    succeed(
      option,
      { error: { code: 'TRIP_FORBIDDEN', message: '无权查看该行程的评论' } },
      403
    )
  );
  await expectReject(
    () => service.listComments('trip_T'),
    (error) => error.code === 'TRIP_FORBIDDEN' && error.statusCode === 403,
    '非成员 403 必须真实抛出'
  );

  installWx((option) => option.fail?.({ errMsg: 'request:fail timeout' }));
  await expectReject(
    () => service.addComment('trip_T', 'B1'),
    (error) => error.code === 'COMMENT_NETWORK_ERROR',
    '网络错误必须明确抛出'
  );

  installWx((option) =>
    succeed(
      option,
      { error: { code: 'COMMENT_INVALID_INPUT', message: '评论内容不能为空' } },
      400
    )
  );
  await expectReject(
    () => service.addComment('trip_T', '  '),
    (error) => error.code === 'COMMENT_INVALID_INPUT' && error.statusCode === 400,
    '服务端校验错误必须透传'
  );

  console.log('✅ real-comment-service.test.ts 全部通过');
}
