// server/src/app.ts
// CoTrip Backend V0.2 入口：组装依赖并启动 HTTP 服务。

import express from 'express';
import { loadConfig } from './config';
import { JsonUserRepository } from './repositories/json-user-repository';
import { JsonTripRepository } from './repositories/json-trip-repository';
import { RealWechatService } from './services/wechat-service';
import { HmacTokenService } from './services/token-service';
import { RealAuthService } from './services/auth-service';
import { authRouter } from './routes/auth';
import { RealTripService } from './services/trip-service';
import { tripRouter } from './routes/trips';
import { JsonCommentRepository } from './repositories/json-comment-repository';
import { CommentService } from './services/comment-service';
import { commentRouter } from './routes/comments';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

export function createApp() {
  const config = loadConfig();

  const users = new JsonUserRepository(config.dataFile);
  const wechat = new RealWechatService(config.wechatAppId, config.wechatSecret);
  const tokens = new HmacTokenService(config.authTokenSecret);
  const auth = new RealAuthService(users, wechat, tokens);
  const tripRepository = new JsonTripRepository(config.tripDataFile);
  const trips = new RealTripService(tripRepository);
  const commentRepository = new JsonCommentRepository(config.commentDataFile);
  const comments = new CommentService(commentRepository, tripRepository);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter(auth, tokens));
  app.use('/trips', tripRouter(trips, tokens));
  // 评论挂在 /trips/:id/comments；tripRouter 的 /:id 只匹配单段，不会捕获多段路径
  app.use('/trips', commentRouter(comments, tokens));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// 直接运行时启动服务（被测试 import 时不启动）
if (require.main === module) {
  const config = loadConfig();
  const app = createApp();
  const host = '127.0.0.1';
  app.listen(config.port, host, () => {
    console.log(`CoTrip Backend V0.2 listening on http://${host}:${config.port}`);
  });
}
