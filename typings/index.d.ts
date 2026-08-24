/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    currentUser: import('./types/participant').Participant | null;
    pendingJoinRoomCode: string | null;
    /** 启动时会话恢复结果；登录页等待它做冷启动路由(AUTH_LOADING 阶段) */
    authReady?: Promise<import('./services/auth-service').LoginResult | null>;
  };
}
