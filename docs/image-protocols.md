# 生图协议与官方接口

在 **设置与 API → 生图API配置卡 → 生图协议** 选择协议并保存。已有 Key、模型与作品保留；各配置可以选择不同协议，主备切换时使用对应配置的协议。

| 选择 | API 前缀示例 | 请求方式 |
| --- | --- | --- |
| OpenAI Images | 服务商提供的完整 `/v1` 前缀 | 文字生图使用 JSON `/images/generations`；参考图使用 multipart `/images/edits`。 |
| Gemini 原生 | 服务商根地址或 `/v1beta` | JSON `/v1beta/models/{model}:generateContent`，Key 放 `x-goog-api-key` 请求头。 |
| Seedream（豆包） | `https://ark.cn-beijing.volces.com/api/v3` | JSON `/images/generations`；文字与参考图共用此接口，使用 Bearer Key。 |
| Qwen-Image（千问） | 阿里云控制台对应地域、工作空间的 `/compatible-mode/v1` 前缀 | JSON `/images/generations`；文字与参考图共用此接口，使用 Bearer Key。 |

**自动**根据模型名识别：`gemini-`、`seedream-` / `doubao-seedream-`、`qwen-image`，其他模型使用 OpenAI Images。火山方舟官方主机也会识别为 Seedream。使用 `ep-...` 或第三方别名时，可手动指定；如果中转服务将模型转换为标准 OpenAI Images，请选择 OpenAI Images。

Seedream 和 Qwen 支持填写完整生成地址，或填写 API 前缀。非空前缀原样保留，不再追加多余的 `/v1`；第三方服务请按其文档填写完整前缀。Qwen 的地域、工作空间、模型和 Key 需匹配，不会自动切换地域。无路径的根地址分别补 `/api/v3` 和 `/compatible-mode/v1`。

## Seedream

已按火山方舟官方同步接口接入文字生图、单图/多图参考编辑。参考图通过 JSON `image` 传递，单图为 Data URL 字符串，多图为字符串数组。输出 `data[].url` 或 `data[].b64_json` 复用现有保存流程；返回格式不同也保留原图。

- 5.0 Pro/Flash 最多 10 张参考图；5.0 Lite、4.5、4.0 最多 14 张。每图最多 30 MiB，宽高大于 14 像素，总像素不超过 3600 万，宽高比不超过 16:1。
- 自动尺寸使用服务默认值。手动宽高按该型号限制检查：5.0 Pro/Flash 为 921600–4624220 像素；5.0 Lite/4.5 为 3686400–16777216；4.0 为 921600–16777216，宽高比均为 1:16 至 16:1。
- 5.0 系列可请求 PNG/JPEG；4.0/4.5 使用服务默认输出格式。此入口不转码。
- 5.0 Pro/Flash 的原生透明模式需要一张带透明通道的 PNG 参考图，并选择 PNG 输出。普通文生图的透明需求可选择项目已有的本地处理。
- 不发送 OpenAI 的 `quality`、`moderation`、压缩参数或蒙版；蒙版请求在本地提示不支持。水印沿用服务默认值。

## Qwen-Image

已按用户所指官方文档的 **OpenAI 兼容同步协议** 接入，包括 `qwen-image-3.0-pro`、`qwen-image-3.0`、`qwen-image-2.1-pro`、`qwen-image-2.1-turbo`。参考图同样使用 JSON `image`，不调用 `/images/edits`。

- 3.0 系列最多 3 张参考图；2.1 系列最多 10 张。每图最多 10 MiB，宽高各不超过 8000 像素，宽高比不超过 10:1。
- 输出支持自动尺寸，或 262144–4194304 总像素、宽高比 1:8 至 8:1 的手动尺寸。
- 官方输出 PNG、返回图片 URL。选择 JPEG/WebP 不会改变服务输出；保存时显示实际 PNG 格式。`response_format=b64_json` 不会强制转为 Base64 返回。
- 不发送未支持的质量、输出压缩、透明背景、蒙版或流式参数；蒙版、原生透明请求在提交前提示不支持，可使用本地透明处理。

两种新协议沿用项目每张独立请求的批量生图方式，使用同步返回。没有添加 Seedream 图层拆分、交互标记、联网及原生组图，也没有接入 Qwen 的另一套 DashScope 异步任务协议。现有输入读取支持 PNG/JPEG/WebP。

## CLI

已保存的配置直接共用协议。独立调用可用 `--protocol seedream` 或 `--protocol qwen`，JSON 配置对应 `imageProtocol` 字段。`--dry-run` 只做本地检查，不代表服务商可用。详细用法见 [CLI 说明](codex-image-interface.md)。

## 官方依据

核对日期：2026-10-13。服务商后续能力变化以其文档为准。

- [Seedream 图片生成 API](https://www.volcengine.com/docs/82379/1541523)
- [火山方舟 Base URL 与鉴权](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh)
- [Qwen-Image 图像生成与编辑 API](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
