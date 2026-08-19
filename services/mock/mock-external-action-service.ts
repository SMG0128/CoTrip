// services/mock/mock-external-action-service.ts
// ExternalActionService 实现：委托给 ExternalActionResolver 执行真实动作。

import { ExternalActionService } from '../external-action-service';
import { ExternalAction, ExternalActionResult } from '../../types/external-action';
import { externalActionResolver } from '../providers/external-action-resolver';

export class MockExternalActionService implements ExternalActionService {
  async execute(action: ExternalAction): Promise<ExternalActionResult> {
    return externalActionResolver.execute(action);
  }

  describe(action: ExternalAction): string {
    switch (action.mode) {
      case 'URL':
        return action.provider === 'dianping' ? '大众点评' : '打开链接';
      case 'API':
        return action.action === 'open_route' ? '怎么去' : '查看地图';
      case 'MINIPROGRAM':
        return '打开小程序';
      default:
        return '打开';
    }
  }
}