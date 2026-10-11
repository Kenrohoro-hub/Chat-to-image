# 图片审核可控范围与开源方案

核实日期：2026-10-04。范围：保留现有 GPT 图片服务，或改用本地开源模型；本次只核对资料与项目代码，未部署或调用模型。

有开源方案可以关闭特定的本地输出检查器；现有 GPT Image 服务没有官方“完全关闭审核”参数。两者控制的是不同环节，不能把本地检查器的开关套用到远程 GPT 接口。

| 路线 | 已核实的能力 | 对当前工具的影响 |
|---|---|---|
| 保留 GPT Image | OpenAI 官方仅提供 `moderation=auto` 和 `low`；`low` 是较宽松过滤，提示词和生成图片仍会被过滤。 | 可以沿用现有审核按钮选择“低”，不能承诺关闭服务端审核。[1] |
| 本地旧 Stable Diffusion | Diffusers 官方明确：旧检查点的输出检查器可在 `DiffusionPipeline.from_pretrained()` 中传入 `safety_checker=None` 关闭。该检查器对生成结果匹配固定概念。 | 需要换用相应模型并建立本地推理入口；关闭范围限于这个组件。[2] |
| 其他本地模型 | 同一官方文档说明 Qwen-Image 等较新模型没有上述检查器。 | 没有该组件不等于模型没有自身限制；应核对具体模型与所用运行环境，不能泛化为所有开源模型都能完全关闭审核。[2] |

## 当前实现

本工具是所配置图片服务的客户端。网页参数类型限定为 `auto` / `low`，请求实现将该值传给 Images 或 Responses 接口；CLI 的 `--moderation` 也仅接受这两个值。响应解析同样只识别它们。相关入口见 [任务参数](../src/types.ts)、[请求实现](../src/lib/openaiCompatibleImageApi.ts)、[响应参数解析](../src/lib/imageApiShared.ts) 和 [CLI](../scripts/playground_image.py)。这些入口没有本地内容审核器可关闭；修改界面标签或添加未经接口支持的 `none` 值，不能控制服务器的审核。

第三方兼容服务是否支持额外参数，须以其实际接口文档和响应为准；本次没有验证任何第三方“关闭审核”承诺。

## 选路前仍需确认

保留 GPT 模型时，可使用现有“低”审核选项。选择本地开源路线时，需要确定模型、运行方式及模型文件、内存/显存等资源；本次未核验设备资源、未下载模型，也未执行部署或生成，因此没有本机可用性、画质或速度结论。用户选定路线前，不新增假关闭按钮。

## 官方来源与证据状态

以下官方页面的相关原文已由主代理通过配置名为 `playwright` 的 MCP 取得，本次独立复核保存的原文与项目代码，未再次联网。

1. [OpenAI：Image generation — Content Moderation](https://developers.openai.com/api/docs/guides/image-generation)：明确所有提示词与生成图片会过滤，参数支持 `auto`、`low`。
2. [Hugging Face Diffusers：Legacy checkpoints — Safety checker](https://huggingface.co/docs/diffusers/main/en/using-diffusers/legacy_checkpoints#safety-checker)：明确旧 Stable Diffusion 检查器的关闭参数，并说明 Qwen-Image 等较新模型不带该检查器。
