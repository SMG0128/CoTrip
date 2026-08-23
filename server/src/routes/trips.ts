// 认证 Trip API：HTTP 解析/校验后委托给 TripService。

import { Router, Request, Response, NextFunction } from 'express';
import { TokenService } from '../services/token-service';
import { TripService } from '../services/trip-service';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types/errors';
import { CreateTripInput, TripStatus } from '../types/trip';

const TRIP_STATUSES: TripStatus[] = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

export function tripRouter(trips: TripService, tokens: TokenService): Router {
  const router = Router();
  const authenticate = requireAuth(tokens);

  router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // 只提取 client-controlled 字段。creatorId/status 等即使提交也不会进入业务层。
      const input: CreateTripInput = {
        title: typeof body.title === 'string' ? body.title : '',
        initialBrief: typeof body.initialBrief === 'string' ? body.initialBrief : '',
        areaConstraint: body.areaConstraint,
        timeRange: body.timeRange,
      };
      const trip = await trips.createTrip(req.userId!, input);
      res.status(201).json({ trip });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawStatus = req.query.status;
      let status: TripStatus | undefined;
      if (rawStatus !== undefined) {
        if (typeof rawStatus !== 'string' || !TRIP_STATUSES.includes(rawStatus as TripStatus)) {
          throw new AppError(400, 'TRIP_INVALID_STATUS', '行程状态无效');
        }
        status = rawStatus as TripStatus;
      }
      const result = await trips.listTrips(req.userId!, status);
      res.json({ trips: result });
    } catch (err) {
      next(err);
    }
  });

  // 公开邀请预览：只返回最小投影，不要求登录、不暴露 participantIds/creatorId。
  // 必须声明在 /:id 前，避免 join-preview 被当作 Trip id。
  router.get('/join-preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roomCode = typeof req.query.roomCode === 'string' ? req.query.roomCode : '';
      const preview = await trips.getJoinPreview(roomCode);
      res.json({ preview });
    } catch (err) {
      next(err);
    }
  });

  // 加入身份只取 Bearer token，忽略 body 中所有 userId/participantIds/creatorId 等 spoof 字段。
  router.post('/join', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const roomCode = typeof body.roomCode === 'string' ? body.roomCode : '';
      const trip = await trips.joinTrip(req.userId!, roomCode);
      res.json({ trip });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const trip = await trips.getTrip(req.userId!, req.params.id);
      res.json({ trip });
    } catch (err) {
      next(err);
    }
  });

  // 完成行程：身份只取认证中间件注入的 userId，不读 body 参与权限判断。
  router.post(
    '/:id/complete',
    authenticate,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const trip = await trips.completeTrip(req.userId!, req.params.id);
        res.status(200).json({ trip });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
