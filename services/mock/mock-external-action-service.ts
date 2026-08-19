// services/mock/mock-external-action-service.ts
// ExternalActionService 的 Mock 实现。

import { ExternalActionService } from '../external-action-service';
import { ExternalAction } from '../../types/external-action';

export class MockExternalActionService implements ExternalActionService {
  async execute(action: ExternalAction): Promise<void> {
    // Mock：仅提示，不真正跳转
    console.log('[MockExternalActionService] execute', action.provider, action.mode);
  }

  describe(action: ExternalAction): string {
    switch (action.mode) {
      case 'MAP':
        return '地图';
      case 'URL':
        return action.provider === 'dianping' ? '大众点评' : '打开链接';
      case 'API':
        return '调用接口';
      case 'MINIPROGRAM':
        return '打开小程序';
      default:
        return '打开';
    }
  }
}