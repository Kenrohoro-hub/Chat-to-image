# 本地接口模拟

供开发测试使用，不调用收费服务。启动 `npm run mock:api`，默认地址 `http://127.0.0.1:8787`；端口可用环境变量 `MOCK_IMAGE_API_PORT` 调整。

在 **生图API配置卡** 中填写地址 `http://127.0.0.1:8787/模式名`，Key 和模型填 `mock`。跨域模式用于浏览器直连测试，桌面同步请求通过本机服务发送。

| 模式 | 模拟行为 |
| --- | --- |
| `url-ok` / `b64` | 返回图片 URL / Base64。 |
| `url-cors-block` | 图片 URL 不提供 CORS。 |
| `url-404` | 图片下载返回 404。 |
| `url-redirect-cors-block` | 图片地址重定向，目标无 CORS。 |
| `wrong-shape` / `no-recognizable` / `empty` | 响应结构不匹配、无图片字段、空结果。 |
| `http-error` / `invalid-json` | HTTP 500 / 非法 JSON。 |
| `slow` / `api-no-cors` | 延迟响应 / API 无 CORS。 |
| `alternating-http-error` | 间隔返回 HTTP 500，用于部分失败测试。 |
| `drop-image-tool` | 丢弃图像工具，返回工具参数错误。 |
| `stream-unsupported` | 流式请求返回 400。 |
| `stream-invalid-json` / `stream-no-data` | SSE 非法 JSON / 无有效事件。 |
| `stream-failed-event` / `stream-error-object` | 失败事件 / 错误对象。 |
| `stream-no-final` / `stream-no-usable` | 只有中间图片 / 完成事件无图片。 |

流式模式需开启流式传输。模拟服务按请求的 `n` 返回结果，最多 10 张；Responses 的 `empty`、`no-recognizable`、`wrong-shape` 用于图片提取失败测试。

自定义协议的测试接口：

- 同步提交：`custom/random-image`，图片字段 `data.url` 或 `data.images[].url`。
- 异步提交：`custom/async-submit`，任务 ID 字段 `data`。
- 查询：`custom/tasks/{task_id}`，状态 `data.status`，成功 `SUCCESS`，失败 `FAILURE`，错误 `data.fail_reason`，图片 `data.data.data[].url/b64_json`。
- 模型可用 `mock:url-ok`、`mock:b64`、`mock:url-cors-block`、`mock:http-error`、`mock:no-recognizable`、`mock:async-failure`、`mock:async-no-task-id`、`mock:async-empty`。

接口实现见 [mock-image-api.mjs](../scripts/mock-image-api.mjs)，配置结构见 [自定义服务商参考](custom-provider-llm-prompt.md)。
