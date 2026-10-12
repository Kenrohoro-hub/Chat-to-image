# 自定义服务商配置参考

配置结构与可复用的 LLM 提示词见 [settingsCustomProvider.ts](../src/lib/settingsCustomProvider.ts)。当前设置页管理 Images / Responses 配置；自定义协议适配用于开发和配置导入。

| 字段 | 用途 |
| --- | --- |
| `customProviders` | 服务商接口描述，包含 `id`、`name`、`submit`，可选 `editSubmit`、`poll`。 |
| `profiles` | 连接配置，`provider` 引用服务商 ID，包含 `baseUrl`、`model`、`apiMode`。 |
| `submit` / `editSubmit` | 请求路径、方法、JSON 或 multipart 正文及文件字段；同步响应通过 `result` 提取图片。 |
| `poll` | 任务查询路径、间隔、状态值、错误字段及图片提取规则。 |
| `result` | `imageUrlPaths` / `b64JsonPaths`，支持 `*` 遍历数组。 |

正文可引用 `$profile.model`、`$prompt`、`$params.*`、`$inputImages.dataUrls` 和 `$mask.dataUrl`。multipart 文件使用 `inputImages` 或 `mask` 来源；异步任务路径使用 `{task_id}`。

按服务商文档填写接口、状态和结果路径，不猜测配置。Key 由用户在应用中填写，不写进共享模板。
