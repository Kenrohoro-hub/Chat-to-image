import { t } from './i18n'
export function getApiFailureAdvice(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/401|403|unauthorized|forbidden|鉴权/i.test(message)) return t('鉴权或访问被拒绝。核对 Key、账户权限和接口地址；修正后重新获取模型。', 'Authentication or access was denied. Check your key, account permissions and API URL, then fetch models again.')
  if (/429|rate.limit|限流|余额|quota|billing/i.test(message)) return t('服务商限流或额度不足。检查服务商余额或限流说明；稍后再试，勿连续重复提交。', 'The provider rate limit or quota was reached. Check your balance and limits, then try again later. Avoid repeated submissions.')
  if (/404|405|model catalog|模型列表|模型目录|兼容的模型/i.test(message)) return t('目录接口不可用或响应不兼容。确认接口地址；服务商可能不提供模型目录，可按其说明手动添加模型。', 'The model catalog is unavailable or incompatible. Check the API URL. If the provider has no catalog, add models manually using its documentation.')
  if (/timeout|timed.out|abort|超时/i.test(message)) return t('请求超时或中断。检查网络与服务商状态。生图超时可能已被受理，先核对服务商记录再决定重试。', 'The request timed out or was interrupted. Check the network and provider status. An image request may already have been accepted; check the provider records before retrying.')
  if (/fetch|network|cors|网络|跨域|连接/i.test(message)) return t('连接失败。检查网络和接口地址；浏览器对话请求还需服务商允许跨域。', 'Connection failed. Check the network and API URL. Browser chat requests also require the provider to allow cross-origin access.')
  return t('查看服务商的接口与模型能力说明；目录获取失败时仍可手动添加模型。', 'Check the provider documentation for supported APIs and models. Models can still be added manually if the catalog cannot be fetched.')
}
