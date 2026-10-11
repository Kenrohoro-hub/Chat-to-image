# Codex 直接调用图片接口

此项目提供独立 CLI：Agent 执行命令，调用你配置的图片服务，将图片写入本地，并返回 JSON。仅需 Python 3.10 或更新版本，无第三方 Python 依赖。桌面保存配置后可独立运行，无需保持 UI 打开。

支持 OpenAI 兼容 **Images API 的同步、非流式接口**：文生图、多参考图编辑、PNG 蒙版局部修改、顺序批量生成，以及 PNG / JPEG / WebP 输出。服务商需支持所选模型及参数。Agent 的 Responses 对话、Codex CLI 特殊模式、本地抠图及旧 fal.ai / 自定义供应商 / sub2api 记录不属于此入口。

脚本位于项目的 `scripts/playground_image.py`。以下命令均在项目根目录运行；Codex 在其他目录调用时，可以使用脚本的绝对路径。

统一入口为 `chat-to-image.cmd`，对应 `scripts/chat_to_image.py`，生成与编辑复用同一执行器。命令不依赖桌面窗口，输入与输出的相对路径仍按调用时所在目录解析：

```powershell
.\chat-to-image.cmd --version
.\chat-to-image.cmd doctor
.\chat-to-image.cmd agent-guide
.\chat-to-image.cmd generate --prompt-file prompt.txt --size 1k
```

`doctor` 只检查本地运行时、脱敏配置和已保存模型，不解密 Key、不联网、不写配置；成功不代表凭据或服务商已验证。`agent-guide [usage]` 读取当前程序的这份说明，不从网络更新。可在子命令前使用 `--config-dir 绝对路径` 为本次调用指定共享配置目录；该选项不改变其他进程。

## 1. 配置服务和凭据

### 共用本机配置（推荐）

1. 双击 `run-app.cmd`，在“设置与 API → API 配置 → 画廊”填写连接配置，按需添加，每组最多 10 套配置（含停用项）。Agent Responses 另有独立配置组，CLI 不读取 Agent 主备池。
2. 配置由当前 Windows 用户加密保存到项目 `user-config/`；桌面或 `run-sync.cmd` 打开的本地网页保存后，CLI 直接读取，其他已打开入口自动更新。历史与默认图片输出仍在本机用户目录，复制工具时跳过配置文件夹。
3. 运行 `python -B scripts/playground_config.py` 查看脱敏状态；默认调用不附加独立配置覆盖参数。
4. 换机重新填写 Key，迁移历史和定位项目的方法见 [使用说明](../README_使用说明.md)。

默认优先本机共享设置，尚无共享设置时才读取旧浏览器同步快照。`--saved-profile ID` 选择已保存配置：池内 ID 按主用/备用规则路由；池外 ID 只使用对应的标准同步 Images 配置。显式指定该参数时不使用地址/模型环境覆盖。它不能与 `--config`、`--base-url`、`--model` 或 `--api-key-env` 一起使用。

结果 `config_source` 为 `desktop` 或 `browser_sync`；预检查 `credential_source` 为 `windows_dpapi`。预检查不解密 Key，因此不代表 Key 有效或服务可用。

可用 `--saved-model MODEL_ID` 指定桌面画廊方案已启用的模型；备用也必须启用同一 ID，否则不向它提交。该参数只适用于桌面保存配置，不能替代独立配置模式的 `--model`。界面 Agent 生图也复用画廊通道，仍不改变 CLI 的独立进程及输出目录。

主备规则见 [使用说明](../README_使用说明.md#动态-api-主备配置)。配置列表不设固定槽位；标准方案统一管理，特殊模式标明独立使用。`run-sync.cmd` 打开本地网页，读取和保存同一份共享配置。

### 独立配置（可选）

将 `playground-cli.example.json` 复制为 `playground-cli.local.json`，填写 `baseUrl` 和 `model`。Base URL 必须包含服务商要求的完整前缀，例如 `https://api.example.com/v1`；脚本直接追加 `/images/generations` 或 `/images/edits`，不会自动补 `/v1`。

独立配置模式的 Key 从环境变量读取，默认变量名为 `PLAYGROUND_API_KEY`。可在 Windows 的“编辑账户的环境变量”中新增此变量，值填服务商的 Key，然后完全退出并重新打开 Codex，使新进程获得变量。也可由已有的凭据管理方式为运行脚本的进程设置变量。

不要把 Key 写进配置、提示词或命令参数。配置中的 `apiKey` 会被忽略。若你已使用其他变量名，可在配置中填写 `apiKeyEnv`，或传 `--api-key-env 变量名`；这只选择变量名，不会改变服务地址。

独立配置模式中，服务地址和模型的优先级为：命令参数 → `PLAYGROUND_BASE_URL` / `PLAYGROUND_MODEL` 环境变量 → 指定的配置文件。显式指定配置、地址、模型、凭据变量，或存在上述地址/模型环境变量时，会停用网页同步密钥，避免将它用于另一个服务。要使用网页同步，请移除这些覆盖项。

可以用 `--config` 读取已有 Chat to image `profiles` JSON，搭配 `--profile 配置ID` 选择条目。多个配置未指定 ID 时，必须有且只有一个 `isDefault: true`。只接受 `provider: openai`、`apiMode: images` 的条目。

`playground-cli.local.json`、`outputs/` 已加入 Git 忽略规则。脚本不会自行加载本地配置文件，需明确传入 `--config`。

## 2. 先检查，再生成

只检查配置、图片和输出路径，不读 Key、不联网、不写文件：

```powershell
py -3 scripts/playground_image.py --prompt "一只橙色纸飞机，纯白背景" --dry-run
```

实际文生图：

```powershell
py -3 scripts/playground_image.py --prompt "一只橙色纸飞机，纯白背景，摄影棚柔光" --size 1k
```

多参考图编辑：

```powershell
py -3 scripts/playground_image.py --image reference.png --image style.jpg --prompt "保留第一张主体，采用第二张的配色"
```

蒙版局部修改：

```powershell
py -3 scripts/playground_image.py --image reference.png --mask mask.png --prompt "将透明蒙版区域改成蓝色花瓶"
```

蒙版必须是带 Alpha 通道的 PNG，尺寸与第一张参考图一致；透明区域用于修改。脚本不缩放或重绘输入图片。参考图支持 PNG、JPEG、WebP，最多 16 张，参考图与蒙版总计不超过 50 MiB。

较长提示词建议保存在 UTF-8 文件中，通过 `--prompt-file prompt.txt` 传入，可以保留多行文本并避免命令行引号问题。`--prompt` 与 `--prompt-file` 只能选择一个。

也可用 Windows 包装入口，参数相同：

```powershell
.\run-image.cmd --prompt-file prompt.txt
```

`run-image.cmd` 从自身位置找到脚本，输入、配置和输出的相对路径均按**调用时所在目录**解析；`run-app.cmd` 负责启动桌面窗口。

## 3. 在 Codex 中使用

可以直接告诉 Codex：

> 使用 Chat to image 的共享配置，生成一张极简咖啡店海报，竖版，保存到本机用户目录，并展示结果。

旧的 `generate-playground-image` 已卸载。新的 CLI 接入不依赖 `PLAYGROUND_PROJECT_ROOT`，也不修改 Agent 的全局默认生图偏好。Agent 应先读取 `agent-guide`，再根据本次请求调用 `generate`；服务地址、模型和 Key 仍需按第 1 节配置。

在桌面“设置与 API → Agent 连接”中，选择 Codex、Claude Code、Cursor 或 DeepSeek Harness 并点击连接。工具先验证 Python 和 CLI，再在所选 Agent 用户技能目录生成 `chat-to-image-cli/SKILL.md`：只含触发条件、本机绝对调用路径与 `agent-guide` 引导。重新打开 Agent 会话以读取新接入；文件就绪不代表宿主已加载，也不代表供应商已验证。

该页的“手动调用命令”按当前项目位置即时生成，使用 `chat-to-image.cmd` 自动寻找当前电脑的 Python，不附带固定的 Python 路径或 `--config-dir`。CLI 默认从当前项目读取配置；换电脑或移动项目后，重新打开该页并复制新命令。连接状态 JSON 的 `manual_command` 是此启动入口，`command` 仍是接入管理验证过的完整 Agent 前缀。

也可在项目目录通过 CLI 管理：

```powershell
.\chat-to-image.cmd agents status
.\chat-to-image.cmd agents connect --target codex
.\chat-to-image.cmd agents update --target codex
.\chat-to-image.cmd agents disconnect --target codex
```

`--target` 支持 `codex`、`claude`、`cursor`、`deepseek-harness`，写入操作必须明确指定目标；`status` 可省略目标查看全部。Codex 使用当前用户 `.agents/skills`，Cursor 使用 `.cursor/skills`，Claude 使用 `.claude/skills`，设置了 `CLAUDE_CONFIG_DIR` 时使用其 `skills`。`CHAT_TO_IMAGE_AGENT_HOME` 可为隔离测试或便携使用指定绝对用户目录，未设置时使用当前用户目录；本轮测试仅使用隔离目录。

DeepSeek Harness 使用当前用户 `.dsh/skills/chat-to-image-cli/SKILL.md`，非空 `DSH_HOME` 则使用其 `skills/chat-to-image-cli`，这里要求绝对路径。目录约定依据 [官方 filesystem skill provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/skill/skill-filesystem)；使用自定义 composition 时须启用 `@deepseek-ai/dsh-skill` 与 `@deepseek-ai/dsh-skill-filesystem`，且不能关闭默认用户目录扫描。若在 Harness 配置里显式指定了另一个 `dshHome`，请让启动本工具时的 `DSH_HOME` 指向相同位置。连接功能不安装 Harness，不修改它的模型、API Key 或 composition。

```powershell
.\chat-to-image.cmd agents connect --target deepseek-harness
.\chat-to-image.cmd agents status --target deepseek-harness
.\chat-to-image.cmd agents update --target deepseek-harness
.\chat-to-image.cmd agents disconnect --target deepseek-harness
```

Harness 还会读取共享 `.agents/skills`，因此已有 Codex 接入可能也被它发现。DeepSeek Harness 选项管理的是 `.dsh` 专属接入；断开该项不会删除 Codex 共享接入。项目级同名技能也可能优先于用户级技能，以 Harness 实际加载的文件为准。


更新/断开前备份本工具拥有的接入文件，结果显示本机备份位置。归属文件为 `.connection.json`；个人修改、缺失的受管文件、未知接入或其他项目的同名接入会显示冲突并拒绝覆盖。断开只处理两个受管文件，保留其他个人文件。连接状态查询不写文件；程序升级后指南即时跟随当前 CLI，短接入有变化时可手动更新。

完整命令固定当前 Python、项目和共享配置目录，无需新 PATH 或全局项目环境变量。移动项目前先在旧位置断开，新位置重新连接；换电脑或 Windows 账户后重新填写 API 并连接。新接入不会修改旧环境变量、其他 Skill 或 Agent 全局规则。普通网页只提供使用说明，用户级接入管理限于桌面原生桥或明确调用的 CLI。

Python 脚本本身就是生图调用入口，无需等待 Skill 列表刷新即可使用。本地 HTTP 服务提供页面；桌面通过原生桥接共享配置与提交任务；当前未注册为 MCP 服务。

## 4. 参数与结果

| 参数 | 含义 |
| --- | --- |
| `--size` | 默认 `1k`；也可用 `auto`、`宽x高`、`1k/2k/4k` 及 `-landscape` / `-portrait` |
| `--quality` | `auto`（默认）、`low`、`medium`、`high`、`xhigh`、`max` |
| `--format` | `png`（默认）、`jpeg`、`webp`；指定输出文件时扩展名需一致 |
| `--background` | 可选 `auto`、`opaque`、`transparent`；透明背景要求 PNG / WebP 且服务商支持 |
| `--count` | 默认 1，最多 100；分开发出 N 个 `n=1` 请求，对应 N 次潜在计费 |
| `--concurrency` | 默认 2，可设为 1；每次 CLI 批次最多同时执行两个请求 |
| `--timeout` | 每次网络操作超时，默认 600 秒；不能改变服务商的超时限制 |
| `--response-format` | 默认不发送；服务商要求时指定 `b64_json` 或 `url` |
| `--output` | 默认本机用户目录的项目数据区下的 `outputs/`；可明确指定导出目录或单张文件名，目录模式自动生成唯一文件名 |

快捷尺寸：1K 方图 1024×1024；2K 方图 2048×2048；4K 默认横图 3840×2160。横竖快捷值可通过 `--help` 查看名称。自定义尺寸遵循项目现有约束：边长为 16 的倍数、最长边不超过 3840、比例不超过 3:1、像素数在 655360–8294400 之间；具体模型可能有更严格限制。

除 `--help` 外，标准输出始终为一个 JSON 对象。成功退出码为 0，失败为 1。结果包含：

```json
{
  "schema_version": 1,
  "ok": true,
  "request_mode": "sync",
  "stage": "done",
  "attempted_requests": 1,
  "completed_requests": 1,
  "images": [
    { "path": "图片的绝对路径", "format": "png", "width": 1024, "height": 1024, "bytes": 12345 }
  ],
  "request_ids": [],
  "warnings": []
}
```

`attempted_requests` 为已开始提交的请求数，`completed_requests` 为已完整收到 HTTP 200 响应的生图请求数；是否成功保存以 `images` 为准。`output_paths` 是计划路径，不能据此宣称图片已生成。`--dry-run` 的 `ok: true` 仅表示本地检查通过，不证明 Key、服务商或模型可用。

失败时额外包含 `error.code`、`error.message`，可能包含 `http_status`。批量中途失败会保留先前成功保存的图片并返回它们的路径；不完整的当前输出会被删除。已有文件不会覆盖。

## 5. 错误处理与验证范围

遇到超时、524、断线或中断，请先核对 `stage`、请求数、`request_ids` 和服务商记录。独立配置不自动重试；桌面主备仅在明确拒绝受理时切换，不实现 Relay 异步轮询或幂等重放。已经返回但解码、格式检查或保存失败的响应也可能已计费，应核对服务商记录后再决定是否重新生成。

远程 API 要求 HTTPS，本地调试允许回环 HTTP。脚本拒绝 HTTP 重定向，图片 URL 下载不携带 API Key；若服务商用重定向分发图片，优先使用其 `b64_json` 返回方式。为防止错误正文回显凭据或大段 Base64，脚本只报告 HTTP 状态和处理建议。

脚本检查图片容器头、尺寸和格式，不进行完整像素解码；服务商返回的实际尺寸与请求不一致时，会保留图片并在 `warnings` 中说明。返回格式与请求不一致时会报错。

JPEG 检查沿图片段及扫描数据读取结束标记，允许结束标记后的附加数据。参考图和蒙版检查失败会注明尚未提交生图请求；接口返回图片的检查失败会单独说明，避免混淆上传前错误与服务返回错误。

接口的自动检查使用本机模拟服务，覆盖真实 HTTP 提交、multipart 编辑、文件保存、批量失败及不重复提交等行为，不消耗生图额度。运行：

```powershell
py -3 -B scripts/test_desktop.py
py -3 -B scripts/test_playground_image.py
py -3 -B scripts/test_playground_sync.py
node --test scripts/test-playground-bridge.mjs
```

真实服务端出图仍需提供可用的服务配置和 Key。项目网页使用方法见根目录 `README_使用说明.md`。

## 当前验证状态

请查看唯一状态入口 [开发大纲](../tasks/plan.md)，其中区分真实、模拟与待用户确认的范围。

### 批次保存与模型限制

图片逐张校验后写入输出目录。CLI 默认最多两并发，通过短时自有子进程复用同一执行器；设 `--concurrency 1` 可顺序执行。发现失败后不再投递下一项，已在途请求仍收集结果；Ctrl+C 停止本批进程，保留已经完整写入的图片。停止本地任务不能保证远端停止或退款，状态不明时不自动重跑。多个独立 CLI 批次之间不共享并发额度。

桌面和本机网页通过同一桌面实例限制最多两个工作进程；普通网页的限制在当前页面内生效。同步多图请求拆为单图并逐张保存，取消后已完成图片仍可在当前结果和历史中查看；fal 与自定义异步接口保留其批次及任务恢复标识。

在 **设置与 API → 画廊配置 → 图像模型参数限制** 中，按服务商说明设置允许尺寸、质量、格式、原生透明和参考图上限。留空沿用通用规则，参考图上限 0 表示不支持参考图；原生透明不支持时仍可手动选择已有的本地透明处理。模型目录不会自动推断这些能力，也不会产生付费探测。保存后桌面、网页和 CLI 共用这些声明；备用按各自实际模型检查，不符合的候选不提交。CLI 显式参数不会静默改成另一档，无法匹配时给出错误。

独立 JSON 配置可使用同一字段，例如：

```json
{
  "imageCapabilities": {
    "your-image-model": {
      "sizes": ["512x512", "1024x1024"],
      "qualities": ["high"],
      "formats": ["png"],
      "transparent": false,
      "maxInputImages": 1
    }
  }
}
```

明确声明的尺寸按模型保留；未声明时沿用原尺寸范围。声明应与服务商文档一致，不能扩大远端真实能力。
