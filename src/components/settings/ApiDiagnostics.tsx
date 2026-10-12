import { useMemo } from 'react'
import type { ApiProfile } from '../../types'
import { validateApiProfile } from '../../lib/apiProfiles'
import { getApiFailureAdvice } from '../../lib/apiDiagnostics'
import { useStore } from '../../store'
import { getUiLanguage, t } from '../../lib/i18n'

export default function ApiDiagnostics({ profile }: { profile: ApiProfile }) {
  const tasks = useStore((state) => state.tasks)
  const latest = useMemo(() => tasks.reduce<typeof tasks[number] | undefined>((found, task) => task.apiProfileId === profile.id && task.status !== 'running' && (!found || task.createdAt > found.createdAt) ? task : found, undefined), [tasks, profile.id])
  const error = latest?.error || latest?.outputErrors?.[0]?.error
  const invalid = validateApiProfile(profile)
  return <div className="space-y-2 text-xs" aria-label={t('API 状态与排错', 'API status and troubleshooting')}>
    <p>{t('本地配置：', 'Local configuration: ')}{invalid ? t(`${invalid}，请补全后保存。`, `${invalid}. Complete the required fields and save.`) : t('必填项完整，尚不代表服务可用。', 'Required fields are complete; service availability is not yet verified.')}</p>
    <p>{t('模型目录：', 'Model catalog: ')}{profile.modelCatalog ? profile.modelCatalog.stale ? t('连接已修改，请重新获取。', 'Connection changed. Fetch the catalog again.') : t(`已获取 ${profile.modelCatalog.ids.length} 个模型；不代表看图、工具或推理能力通过验证。`, `${profile.modelCatalog.ids.length} models fetched; vision, tools, and reasoning are not verified.`) : t('未获取，可点击下方“获取模型”或手动添加。', 'Not fetched. Click Fetch models below or add models manually.')}</p>
    {profile.apiMode === 'images' ? <p>{t('历史生图记录：', 'Past image requests: ')}{latest ? `${new Date(latest.createdAt).toLocaleString(getUiLanguage())} · ${latest.outputImages.length ? t(`已返回 ${latest.outputImages.length} 张图片`, `${latest.outputImages.length} images received`) : t('未取得图片', 'No images received')}${latest.status === 'error' || latest.outputErrors?.length ? t('，存在失败。', '; failures occurred.') : t('。', '.')}` : t('暂无已结束记录。', 'No completed requests yet.')}{t('记录仅对应当时的配置，不验证当前草稿。', ' Records describe the configuration used at the time and do not verify this draft.')}</p> : <p>{t('实际对话：请保存后在创作页发送消息；看图、联网和工具能力需分别以实际结果确认。', 'To test chat, save and send a message in Create. Verify vision, web search, and tools separately using actual results.')}</p>}
    {error && profile.apiMode === 'images' && <p>{t('下一步：', 'Next step: ')}{getApiFailureAdvice(error)}</p>}
    <p className="text-gray-500">{t('此处不自动发送聊天或生图请求。实际调用可能计费。', 'This panel does not send chat or image requests automatically. Actual requests may incur charges.')}</p>
  </div>
}
