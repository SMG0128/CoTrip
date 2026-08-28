// CommentService 的真实后端实现。失败明确抛错，绝不回退 Mock。

import { appConfig } from '../../config/auth';
import { Comment } from '../../types/comment';
import { CommentService } from '../comment-service';

/** 后端评论结构（无前端 AI 状态字段） */
interface BackendComment {
  id: string;
  tripId: string;
  userId: string;
  rawText: string;
  createdAt: string;
}

interface CommentsResponse {
  comments: BackendComment[];
}

interface CommentResponse {
  comment: BackendComment;
}

interface BackendError {
  error?: { code?: string; message?: string };
}

/** 后端评论 → 前端评论：AI 状态在 pipeline 重算前先标记为待处理 */
function hydrate(comment: BackendComment): Comment {
  return { ...comment, aiStatus: 'unresolved' };
}

export class RealCommentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'RealCommentServiceError';
  }
}

export class RealCommentService implements CommentService {
  private get baseUrl(): string {
    return appConfig.baseUrl.replace(/\/$/, '');
  }

  async listComments(tripId: string): Promise<Comment[]> {
    const response = await this.request<CommentsResponse>(
      `/trips/${encodeURIComponent(tripId)}/comments`,
      'GET'
    );
    return response.comments.map(hydrate);
  }

  async addComment(tripId: string, rawText: string): Promise<Comment> {
    const response = await this.request<CommentResponse>(
      `/trips/${encodeURIComponent(tripId)}/comments`,
      'POST',
      { rawText }
    );
    return hydrate(response.comment);
  }

  private request<T>(
    path: string,
    method: 'GET' | 'POST',
    data?: Record<string, unknown>,
    authRequired = true
  ): Promise<T> {
    if (!appConfig.baseUrl) {
      return Promise.reject(
        new RealCommentServiceError('未配置后端地址，无法加载评论', 'COMMENT_BACKEND_NOT_CONFIGURED')
      );
    }

    let header: Record<string, string> | undefined;
    if (authRequired) {
      const token = wx.getStorageSync<string>(appConfig.tokenStorageKey);
      if (!token) {
        return Promise.reject(
          new RealCommentServiceError('登录状态失效，请重新登录', 'AUTH_UNAUTHORIZED', 401)
        );
      }
      header = { Authorization: `Bearer ${token}` };
    }

    return new Promise((resolve, reject) => {
      wx.request({
        url: `${this.baseUrl}${path}`,
        method,
        data,
        header,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300 && response.data) {
            resolve(response.data as T);
            return;
          }
          reject(this.toError(response));
        },
        fail: (error) => {
          reject(
            new RealCommentServiceError(`评论请求失败：${error.errMsg}`, 'COMMENT_NETWORK_ERROR')
          );
        },
      });
    });
  }

  private toError(
    response: WechatMiniprogram.RequestSuccessCallbackResult
  ): RealCommentServiceError {
    const data = response.data as BackendError | undefined;
    return new RealCommentServiceError(
      data?.error?.message || `评论请求失败（${response.statusCode}）`,
      data?.error?.code || 'COMMENT_REQUEST_FAILED',
      response.statusCode
    );
  }
}
