// 认证协调 API。
// - GET  /trips/:id/constraints     → 只读 Constraint Ledger（成员可见）
// - GET  /trips/:id/coordination    → 确定性协调状态（成员可见，AI 不参与）
// - POST /trips/:id/coordination/analyze → Server 自行加载 authoritative constraints 后调用 AI
// 身份：认证中间件注入 userId；绝不信任客户端传入的 constraints。
// 响应中的 AI proposal 是「建议」，不是最终计划；coordinationUnavailable=true 表示 AI 未就绪。

import { Router, Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token-service';
import { TripCoordinationService } from '../services/trip-coordination-service';
import { requireAuth } from '../middleware/auth';

export function coordinationRouter(
  coordination: TripCoordinationService,
  tokens: TokenService,
): Router {
  const router = Router();
  const authenticate = requireAuth(tokens);

  router.get('/:id/constraints', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const constraints = await coordination.listConstraints(req.userId!, req.params.id);
      res.json({ constraints });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/coordination', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await coordination.getCoordination(req.userId!, req.params.id);
      res.json({
        coordination: result.coordination,
        coordinationUnavailable: result.coordinationUnavailable,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/coordination/analyze', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await coordination.analyze(req.userId!, req.params.id);
      res.json({
        coordination: result.coordination,
        ...(result.proposal ? { proposal: result.proposal } : {}),
        coordinationUnavailable: result.coordinationUnavailable,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
