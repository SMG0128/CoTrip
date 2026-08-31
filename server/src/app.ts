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
import { AICommentService, UnavailableAICommentService } from './services/ai-comment-service';
import { OpenAICompatibleAICommentService } from './services/openai-compatible-ai-comment-service';
import { CloudBaseGatewayAICommentService } from './services/cloudbase-gateway-ai-comment-service';
import { ConstraintLedgerService } from './services/constraint-ledger-service';
import { JsonConstraintRepository } from './repositories/json-constraint-repository';
import { TripConstraintEvaluator } from './services/trip-constraint-evaluator';
import {
  TripCoordinationAIService,
  UnavailableTripCoordinationAIService,
} from './services/trip-coordination-ai-service';
import { CloudBaseGatewayTripCoordinationAIService } from './services/cloudbase-gateway-trip-coordination-ai-service';
import { TripCoordinationService } from './services/trip-coordination-service';
import {
  TripPreprocessAIService,
  UnavailableTripPreprocessAIService,
} from './services/trip-preprocess-ai-service';
import { CloudBaseGatewayTripPreprocessAIService } from './services/cloudbase-gateway-trip-preprocess-ai-service';
import { coordinationRouter } from './routes/coordination';
import { errorHandler, notFoundHandler } from './middleware/error-handler';

export function createApp() {
  const config = loadConfig();

  const users = new JsonUserRepository(config.dataFile);
  const wechat = new RealWechatService(config.wechatAppId, config.wechatSecret);
  const tokens = new HmacTokenService(config.authTokenSecret);
  const auth = new RealAuthService(users, wechat, tokens);
  const tripRepository = new JsonTripRepository(config.tripDataFile);
  const aiPreprocess = createTripPreprocessAIService(config);
  const trips = new RealTripService(tripRepository, Math.random, aiPreprocess);
  const commentRepository = new JsonCommentRepository(config.commentDataFile);
  const aiComments = createAICommentService(config);
  const constraintRepository = new JsonConstraintRepository(config.constraintDataFile);
  const ledger = new ConstraintLedgerService(constraintRepository);
  const comments = new CommentService(
    commentRepository,
    tripRepository,
    users,
    aiComments,
    ledger,
  );

  const aiCoordination = createTripCoordinationAIService(config);
  const coordinationEvaluator = new TripConstraintEvaluator();
  const coordinationService = new TripCoordinationService(
    tripRepository,
    constraintRepository,
    coordinationEvaluator,
    aiCoordination,
    commentRepository,
    ledger,
  );

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter(auth, tokens));
  app.use('/trips', tripRouter(trips, tokens));
  // 评论挂在 /trips/:id/comments；tripRouter 的 /:id 只匹配单段，不会捕获多段路径
  app.use('/trips', commentRouter(comments, tokens));
  // 约束与协调状态：同样挂在 /trips/:id/... 下
  app.use('/trips', coordinationRouter(coordinationService, tokens));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function createTripPreprocessAIService(
  config: ReturnType<typeof loadConfig>,
): TripPreprocessAIService {
  if (config.aiGatewayUrl && config.aiGatewaySecret) {
    return new CloudBaseGatewayTripPreprocessAIService({
      gatewayUrl: config.aiGatewayUrl,
      secret: config.aiGatewaySecret,
      timeoutMs: config.aiTimeoutMs,
    });
  }
  // 未配置 PREPROCESS AI Provider：创建流程确定性进行，不写入 AI Context（不伪造）
  return new UnavailableTripPreprocessAIService();
}

function createTripCoordinationAIService(
  config: ReturnType<typeof loadConfig>,
): TripCoordinationAIService {
  if (config.aiGatewayUrl && config.aiGatewaySecret) {
    return new CloudBaseGatewayTripCoordinationAIService({
      gatewayUrl: config.aiGatewayUrl,
      secret: config.aiGatewaySecret,
      timeoutMs: config.aiTimeoutMs,
    });
  }
  // 未配置 Coordinator AI Provider：返回 deterministic state，proposal 缺失（不伪造）
  return new UnavailableTripCoordinationAIService();
}

function createAICommentService(config: ReturnType<typeof loadConfig>): AICommentService {
  if (config.aiProvider === 'cloudbase_gateway') {
    if (config.aiGatewayUrl && config.aiGatewaySecret) {
      return new CloudBaseGatewayAICommentService({
        gatewayUrl: config.aiGatewayUrl,
        secret: config.aiGatewaySecret,
        timeoutMs: config.aiTimeoutMs,
      });
    }
    // 网关配置不齐时明确 unresolved；绝不静默回退。
    return new UnavailableAICommentService();
  }
  if (config.aiBaseUrl && config.aiApiKey && config.aiModel) {
    return new OpenAICompatibleAICommentService({
      baseUrl: config.aiBaseUrl,
      apiKey: config.aiApiKey,
      model: config.aiModel,
      timeoutMs: config.aiTimeoutMs,
    });
  }
  // 未配置 Provider 时明确 unresolved；服务端不提供静默规则 fallback。
  return new UnavailableAICommentService();
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
