# 图片 CLI 接口

`chat-to-image.cmd` 调用同步、非流式 OpenAI Images 或 Gemini 原生 API，支持文字生图、参考图、PNG 蒙版和批量生成，返回本地图片路径。安装版使用内置 Python；源码版需要 Python 3.10+。可在桌面关闭后使用。

## 1. 配置服务和凭据

推荐在 **设置与 API → API 配置 → 生图API配置卡** 保存地址、Key 和模型。CLI 读取同一份加密配置；没有共享配置时读取网页同步快照。

- `--saved-profile ID`：选择已保存图像配置。主备规则见 [使用说明](../README_使用说明.md#模型与备用服务)。
- `--saved-model MODEL_ID`：选择该配置已启用的模型；备用也须启用相同 ID。
- `--config-dir 绝对路径`：放在子命令前，为当前调用指定共享配置目录。
- `--saved-profile` 不能与 `--config`、`--base-url`、`--model`、`--api-key-env`、`--protocol` 合用。

独立配置可从 [示例](../playground-cli.example.json) 创建 `playground-cli.local.json`，填写完整 API 前缀（如 `https://api.example.com/v1`）及模型，通过 `--config` 指定。Key 从环境变量读取，默认 `PLAYGROUND_API_KEY`；`--api-key-env` 只指定变量名，不传入 Key。

独立模式地址/模型优先级：命令参数 → `PLAYGROUND_BASE_URL` / `PLAYGROUND_MODEL` → JSON。显式覆盖地址、模型或配置时，不使用共享密钥。`--config` 也可读取 `profiles` JSON，用 `--profile ID` 选择；未指定时必须有唯一的默认项。

协议默认自动识别：`gemini-` 开头的模型使用 Gemini 原生接口，其他模型使用 OpenAI Images。可在生图配置中指定协议；独立模式用 `--protocol auto/openai/gemini` 或 JSON 的 `imageProtocol`。Gemini 地址可填站点根地址、`/v1` 或 `/v1beta` 前缀，自动使用 `/v1beta/models/{model}:generateContent`。

## 2. 生成与编辑

在程序目录运行。相对输入和输出路径按调用时的目录解析。

```powershell
.\chat-to-image.cmd doctor
.\chat-to-image.cmd agent-guide
.\chat-to-image.cmd generate --prompt-file prompt.txt --dry-run
.\chat-to-image.cmd generate --prompt-file prompt.txt --size 1k
.\chat-to-image.cmd generate --image reference.png --image style.jpg --prompt "保留第一张主体，采用第二张配色"
.\chat-to-image.cmd generate --image reference.png --mask mask.png --prompt "将蒙版透明区域改成蓝色花瓶"
```

`doctor` 只检查本机环境和脱敏配置；`--dry-run` 不读 Key、不联网、不写图片，不能验证真实服务能力。

提示词文件使用 UTF-8。`--prompt` 与 `--prompt-file` 二选一。参考图支持 PNG/JPEG/WebP，最多 16 张；参考图与蒙版总计不超过 50 MiB。蒙版须为带 Alpha 的 PNG，与第一张参考图同尺寸，透明区域用于修改。

Gemini 支持文字与参考图生图；不支持原生蒙版和透明参数。尺寸换算为最接近的支持比例和 1K/2K/4K 档位，`auto` 由模型决定；质量、压缩和文件格式由服务商决定。

## 3. 在 Codex 中使用

在 **设置与 API → Agent 连接** 选择 Codex、Claude Code、Cursor 或 DeepSeek Harness，连接后重新打开 Agent 会话。Agent 先读取 `agent-guide`，再执行 `generate`。移动程序后重新连接以更新路径。

也可用命令管理：

```powershell
.\chat-to-image.cmd agents status
.\chat-to-image.cmd agents connect --target codex
.\chat-to-image.cmd agents update --target codex
.\chat-to-image.cmd agents disconnect --target codex
```

写入操作必须指定 `--target`，可选 `codex`、`claude`、`cursor`、`deepseek-harness`。接入目录：

| Agent | 用户目录中的位置 |
| --- | --- |
| Codex | `.agents/skills/chat-to-image-cli` |
| Claude Code | `.claude/skills/chat-to-image-cli`；设置 `CLAUDE_CONFIG_DIR` 时使用其 `skills`。 |
| Cursor | `.cursor/skills/chat-to-image-cli` |
| DeepSeek Harness | `.dsh/skills/chat-to-image-cli`；设置绝对路径 `DSH_HOME` 时使用其 `skills`。 |

`CHAT_TO_IMAGE_AGENT_HOME` 可指定绝对用户目录。Harness 的自定义 composition 需启用 filesystem skill provider，配置中的 `dshHome` 应与 `DSH_HOME` 一致；共享 `.agents/skills` 中的接入也可能被 Harness 发现。

更新/断开前备份受管接入文件；个人修改、未知归属或其他项目的接入会报冲突，不覆盖。`status` 不写文件。连接管理只提供本地 CLI 接入。

## 4. 参数与结果

| 参数 | 用途 |
| --- | --- |
| `--size` | `auto`、`宽x高`、`1k/2k/4k`，可附 `-landscape/-portrait`；默认 `1k`。 |
| `--quality` | `auto/low/medium/high/xhigh/max`；默认 `auto`。 |
| `--format` | `png/jpeg/webp`；默认 `png`；服务商返回其他有效格式时保留原图并调整扩展名，不转码。 |
| `--background` | `auto/opaque/transparent`；透明需要 PNG/WebP 和模型支持。 |
| `--moderation` | `auto/low`。 |
| `--output-compression` | JPEG/WebP 压缩值，按接口支持设置。 |
| `--response-format` | 接口要求时指定 `b64_json` 或 `url`。 |
| `--count` | 默认 1，最多 100；每张独立请求，可能分别计费。 |
| `--concurrency` | 1 或 2，默认 2；各独立 CLI 批次分别限流。 |
| `--timeout` | 每次网络操作超时，使用配置值或 600 秒。 |
| `--output` | 输出目录或单张文件名；默认本机用户数据区，已有文件不覆盖。 |

更多参数运行 `chat-to-image.cmd generate --help`。尺寸、格式、参考图和质量以配置中声明的模型能力及服务商限制为准。

除帮助输出外，结果为 JSON。成功退出码 0，失败退出码 1：

- `ok`、`stage`：状态；失败附 `error.code`、`error.message`。
- `images[].path`：已保存图片的绝对路径；CLI 图片不自动加入桌面历史。
- `attempted_requests`、`completed_requests`、`request_ids`：已提交和收到响应的请求记录。
- `warnings`：实际尺寸、格式等差异；最终文件位置以 `images[].path` 为准。`output_paths` 仅是计划路径。

## 5. 失败处理

超时、断线、服务器错误或结果不明时，不自动重发；先查请求记录和服务商状态。批量失败保留已保存图片，停止后续投递；停止本地任务不保证远端取消或退款。

远程 API 使用 HTTPS，本机调试允许回环 HTTP。请求拒绝重定向，图片下载不附带 API Key；下载或保存失败时可尝试服务商的 Base64 返回方式，先确认原请求是否受理。
