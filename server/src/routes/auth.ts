// server/src/routes/auth.ts
// 认证路由：POST /auth/login、GET /auth/profile、PATCH /auth/profile。

import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth-service';
import { TokenService } from '../services/token-service';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../types/errors';

export function authRouter(auth: AuthService, tokens: TokenService): Router {
  const router = Router();
  const authenticate = requireAuth(tokens);

  // POST /auth/login
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = (req.body && req.body.code) as unknown;
      const result = await auth.login(typeof code === 'string' ? code : '');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /auth/profile
  router.get('/profile', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await auth.getProfile(req.userId!);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /auth/profile
  router.patch('/profile', authenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { nickname?: unknown; avatarUrl?: unknown };
      const patch: { nickname?: string; avatarUrl?: string } = {};
      if (body.nickname !== undefined) patch.nickname = String(body.nickname);
      if (body.avatarUrl !== undefined) patch.avatarUrl = String(body.avatarUrl);
      const user = await auth.updateProfile(req.userId!, patch);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  return router;
}