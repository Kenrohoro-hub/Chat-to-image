import { t } from './i18n'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { blobToDataUrl } from './dataUrl'
import { putTask, storeImage } from './db'

const EXAMPLES_KEY = 'chat-to-image-examples-v1'
const EXAMPLES = [
  { id: 'example-product', prompt: '为一只白色陶瓷咖啡杯拍摄极简产品照片，暖白背景，柔和侧光，细腻釉面，留出充足留白。', images: ['product'], size: '1024x1024' },
  { id: 'example-paper-boat', prompt: '画一幅温暖的纸艺插画：一艘小船漂浮在云海中，橘色落日，层叠纸张质感，简洁而富有想象力。', images: ['paper-boat', 'paper-boat-sunset'], size: '1024x768' },
  { id: 'example-bookstore', prompt: '设计一间雨天的街角书店，落地窗透出温暖灯光，窗外湿润路面，电影感构图，安静的蓝调时刻。', images: ['bookstore'], size: '768x1024' },
]

export async function seedExampleTasks(existing: TaskRecord[], favoriteCollectionId: string): Promise<TaskRecord[]> {
  if (localStorage.getItem(EXAMPLES_KEY)) return []
  if (existing.some((task) => task.isExample || EXAMPLES.some((example) => example.id === task.id))) {
    localStorage.setItem(EXAMPLES_KEY, '1')
    return []
  }
  const tasks: TaskRecord[] = []
  for (const [index, example] of EXAMPLES.entries()) {
    const outputImages: string[] = []
    for (const image of example.images) {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/${image}.png`)
      if (!response.ok) throw new Error(t('内置示例图片读取失败', 'Could not load the built-in example image'))
      outputImages.push(await storeImage(await blobToDataUrl(await response.blob()), 'generated'))
    }
    const createdAt = Date.now() - (index + 1) * 60_000
    const task: TaskRecord = {
      id: example.id,
      isExample: true,
      isFavorite: true,
      favoriteCollectionIds: [favoriteCollectionId],
      prompt: example.prompt,
      params: { ...DEFAULT_PARAMS, size: example.size, n: outputImages.length },
      apiProfileName: '内置示例',
      inputImageIds: [],
      outputImages,
      status: 'done',
      error: null,
      createdAt,
      finishedAt: createdAt,
      elapsed: null,
    }
    tasks.push(task)
  }
  await Promise.all(tasks.map((task) => putTask(task)))
  localStorage.setItem(EXAMPLES_KEY, '1')
  return tasks
}
