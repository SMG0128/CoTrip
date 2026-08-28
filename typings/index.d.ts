/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    currentUser: import('./types/participant').Participant | null;
    pendingJoinRoomCode: string | null;
    /** 启动时会话恢复信号（仅在冷启动可信）；登录页等待它完成后自行重新 restoreSession 判定当前会话，
     *  退出登录后 reLaunch 回登录页不可沿用该值，否则会被旧会话弹回首页 */
    authReady?: Promise<import('./services/auth-service').LoginResult | null>;
  };
}
