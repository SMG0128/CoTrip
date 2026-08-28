// server/src/config/index.ts
// 从环境变量读取配置。绝不硬编码微信密钥。

import dotenv from 'dotenv';
import path from 'path';

// 加载 server/.env（若存在）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface AppConfig {
  wechatAppId: string;
  wechatSecret: string;
  authTokenSecret: string;
  port: number;
  /** 用户数据持久化文件路径 */
  dataFile: string;
  /** Trip shell 数据持久化文件路径 */
  tripDataFile: string;
  /** 评论流数据持久化文件路径 */
  commentDataFile: string;
  /** OpenAI-compatible 评论分析 Provider；三项齐全才启用。 */
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiTimeoutMs: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少必需环境变量 ${name}，请参考 server/.env.example 配置`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    wechatAppId: required('WECHAT_APPID'),
    wechatSecret: required('WECHAT_SECRET'),
    authTokenSecret: required('AUTH_TOKEN_SECRET'),
    port: Number(process.env.PORT || 3000),
    dataFile: process.env.DATA_FILE || path.resolve(__dirname, '../../data/users.json'),
    tripDataFile:
      process.env.TRIP_DATA_FILE || path.resolve(__dirname, '../../data/trips.json'),
    commentDataFile:
      process.env.COMMENT_DATA_FILE || path.resolve(__dirname, '../../data/comments.json'),
    aiBaseUrl: process.env.AI_BASE_URL?.trim() || undefined,
    aiApiKey: process.env.AI_API_KEY?.trim() || undefined,
    aiModel: process.env.AI_MODEL?.trim() || undefined,
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 15000),
  };
}
