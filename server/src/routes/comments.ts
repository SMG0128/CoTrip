// 认证评论 API：HTTP 解析/校验后委托给 CommentService。
// - GET  /trips/:id/comments  → 共享评论流（服务端 source of truth，按 tripId 查询）
// - POST /trips/:id/comments  → 追加一条评论（append，绝不覆盖已有评论）
// 作者身份只取认证中间件注入的 userId，忽略 body 中任何 userId 字段。

import { Router, Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token-service';
import { CommentService } from '../services/comment-service';
import { requireAuth } from '../middleware/auth';

export function commentRouter(comments: CommentService, tokens: TokenService): Router {
  const router = Router();
  const authenticate = requireAuth(tokens);

  router.get('/:id/comments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await comments.listComments(req.userId!, req.params.id);
      res.json({ comments: list });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/comments', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const rawText = typeof body.rawText === 'string' ? body.rawText : '';
      const comment = await comments.addComment(req.userId!, req.params.id, rawText);
      res.status(201).json({ comment });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
