import { useMemo } from 'react'
import type { ApiProfile } from '../../types'
import { validateApiProfile } from '../../lib/apiProfiles'
import { getApiFailureAdvice } from '../../lib/apiDiagnostics'
import { useStore } from '../../store'

export default function ApiDiagnostics({ profile }: { profile: ApiProfile }) {
  const tasks = useStore((state) => state.tasks)
  const latest = useMemo(() => tasks.reduce<typeof tasks[number] | undefined>((found, task) => task.apiProfileId === profile.id && task.status !== 'running' && (!found || task.createdAt > found.createdAt) ? task : found, undefined), [tasks, profile.id])
  const error = latest?.error || latest?.outputErrors?.[0]?.error
  const invalid = validateApiProfile(profile)
  return <div className="space-y-2 text-xs" aria-label="API 状态与排错">
    <p>本地配置：{invalid ? `${invalid}，请补全后保存。` : '必填项完整，尚不代表服务可用。'}</p>
    <p>模型目录：{profile.modelCatalog ? profile.modelCatalog.stale ? '连接已修改，请重新获取。' : `已获取 ${profile.modelCatalog.ids.length} 个模型；不代表看图、工具或推理能力通过验证。` : '未获取，可点击下方“获取模型”或手动添加。'}</p>
    {profile.apiMode === 'images' ? <p>历史生图记录：{latest ? `${new Date(latest.createdAt).toLocaleString()} · ${latest.outputImages.length ? `已返回 ${latest.outputImages.length} 张图片` : '未取得图片'}${latest.status === 'error' || latest.outputErrors?.length ? '，存在失败。' : '。'}` : '暂无已结束记录。'}记录仅对应当时的配置，不验证当前草稿。</p> : <p>实际对话：请保存后在创作页发送消息；看图、联网和工具能力需分别以实际结果确认。</p>}
    {error && profile.apiMode === 'images' && <p>下一步：{getApiFailureAdvice(error)}</p>}
    <p className="text-gray-500">此处不自动发送聊天或生图请求。实际调用可能计费。</p>
  </div>
}
