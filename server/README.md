# CoTrip Backend V0.1 — Real WeChat Authentication

CoTrip 的第一个真实后端，实现完整的微信登录链路：

```
小程序 → wx.login() → code → CoTrip Backend → 微信 code2Session → openid
→ 查找/创建 CoTrip 用户 → 签发 CoTrip token → 前端保存 token + user → 重启后恢复会话
```

技术栈：Node.js + TypeScript + Express，本地 JSON 文件持久化，环境变量管理密钥。

## 1. 安装

```bash
cd server
npm install
```

## 2. 配置 .env

```bash
cp .env.example .env
```

编辑 `.env`，填入真实值：

```
WECHAT_APPID=你的小程序AppID
WECHAT_SECRET=你的小程序AppSecret
AUTH_TOKEN_SECRET=一段足够长的随机字符串
PORT=3000
```

> 切勿提交真实凭据。`.env` 已在 `.gitignore` 中忽略。

## 3. 运行后端

```bash
npm run dev        # 开发模式（ts-node）
# 或
npm run build && npm start   # 生产模式
```

健康检查：`GET http://localhost:3000/health`

## 4. 配置小程序 baseUrl

编辑 `miniprogram/config/auth.ts`：

```ts
export const authConfig = {
  mode: 'real',
  baseUrl: 'http://localhost:3000',   // 真机调试请改为局域网 IP 或线上域名
  ...
};
```

## 5. 切换认证模式为 real

`config/auth.ts` 中 `mode: 'mock' | 'real'`：

- `mock`：前端无需后端即可运行（开发默认）。
- `real`：走 `wx.login` → 真实后端。后端不可用时登录会明确失败，**不会**回退到 Mock。

## 6. 替换 touristappid

`project.config.json` 中的 `appid` 目前是 `touristappid`（游客模式）。真实登录需替换为你的正式小程序 AppID。

## 7. 配置微信 request 合法域名（部署时）

在微信公众平台 → 开发管理 → 开发设置 → 服务器域名，将后端地址加入 **request 合法域名**（必须为 HTTPS）。

---

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 用 `wx.login` 的 code 登录，返回 `{ token, user }` |
| GET | `/auth/profile` | 校验 token，返回公开用户信息 |
| PATCH | `/auth/profile` | 更新昵称/头像（需登录） |

错误统一返回：

```json
{ "error": { "code": "AUTH_INVALID_CODE", "message": "..." } }
```

## 安全边界

- `WECHAT_SECRET` / `session_key` / `openid` 仅存在于后端，绝不暴露给小程序。
- 小程序只持有 CoTrip token 与 CoTrip userId。
- 业务代码统一使用 `User.id`，不使用 openid。

## 测试

```bash
npm test
```

运行 TypeScript 检查与聚焦的认证单元测试（token 签发/校验、用户仓库、登录流程）。