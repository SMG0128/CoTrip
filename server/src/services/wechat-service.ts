// server/src/services/wechat-service.ts
// 调用微信 code2Session 换取 openid。session_key 仅在此处使用，绝不外泄。

import { AppError } from '../types/errors';

export interface WechatSession {
  openid: string;
  sessionKey: string;
}

export interface WechatService {
  code2Session(code: string): Promise<WechatSession>;
}

interface Code2SessionResponse {
  openid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export class RealWechatService implements WechatService {
  constructor(
    private readonly appId: string,
    private readonly secret: string,
  ) {}

  async code2Session(code: string): Promise<WechatSession> {
    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.appId)}` +
      `&secret=${encodeURIComponent(this.secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new AppError(502, 'AUTH_WECHAT_FAILURE', '微信服务暂时不可用，请稍后重试');
    }

    let data: Code2SessionResponse;
    try {
      data = (await res.json()) as Code2SessionResponse;
    } catch {
      throw new AppError(502, 'AUTH_WECHAT_FAILURE', '微信服务返回异常，请稍后重试');
    }

    // 微信业务错误码：40029 无效 code，40163 code 已被使用，40013 无效 appid，40125 无效 secret
    if (data.errcode) {
      if (data.errcode === 40029 || data.errcode === 40163) {
        throw new AppError(400, 'AUTH_INVALID_CODE', '登录凭证无效或已过期，请重试');
      }
      if (data.errcode === 40013 || data.errcode === 40125) {
        throw new AppError(500, 'AUTH_INVALID_CREDENTIAL', '微信凭据配置错误，请联系管理员');
      }
      throw new AppError(502, 'AUTH_WECHAT_FAILURE', '微信登录失败，请稍后重试');
    }

    if (!data.openid || !data.session_key) {
      throw new AppError(502, 'AUTH_WECHAT_FAILURE', '微信登录失败，请稍后重试');
    }

    return { openid: data.openid, sessionKey: data.session_key };
  }
}