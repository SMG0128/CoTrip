// lib/cloudbase-ai.js
// 真实 provider：CloudBase AI+（成长计划免费额度）。
// provider=hunyuan-v3，model=hy3。
// 不用 cloudbase provider、不用外部 OpenAI API、无收费 fallback、无 mock fallback。
//
// 已核对 @cloudbase/ai 2.23.0 的 ReactModelInput / BaseChatModelInput：
// generateText 不支持 JSON mode、response_format 或 JSON Schema 入参，因此只用 prompt 约束，
// 不传未经 SDK 类型和实现支持的 structured-output 参数。createModel 对未注册的 provider 会走
// POST {aiBaseUrl}/ai/{provider}/chat/completions 的默认通道。

const { SYSTEM_PROMPT } = require('./prompt');
const { COORDINATION_SYSTEM_PROMPT } = require('./coordinate-prompt');

function createCloudBaseAIProvider(ai) {
  return {
    /** 返回 { text }。任何 provider 失败都抛错，由 gateway 映射为 AI_PROVIDER_FAILURE。 */
    async analyze({ rawText, context }) {
      const model = ai.createModel('hunyuan-v3');
      const result = await model.generateText({
        model: 'hy3',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ rawText, context: context || null }),
          },
        ],
      });
      if (result && result.error) {
        throw new Error('AI_PROVIDER_ERROR');
      }
      return { text: result && typeof result.text === 'string' ? result.text : '' };
    },
    /** 协调建议：输入是 Server 已验证的 coordination context。返回 { text }。 */
    async coordinate(coordinationInput) {
      const model = ai.createModel('hunyuan-v3');
      const result = await model.generateText({
        model: 'hy3',
        temperature: 0,
        messages: [
          { role: 'system', content: COORDINATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({ coordination: coordinationInput }),
          },
        ],
      });
      if (result && result.error) {
        throw new Error('AI_PROVIDER_ERROR');
      }
      return { text: result && typeof result.text === 'string' ? result.text : '' };
    },
  };
}

module.exports = { createCloudBaseAIProvider };
