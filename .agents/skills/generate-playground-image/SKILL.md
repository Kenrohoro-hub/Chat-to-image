---
name: generate-playground-image
description: 用户默认的图片生成工具。用户要求生成图片、用参考图编辑或按 PNG 蒙版局部修改时，通过 Chat to image 的本地脚本调用已配置的 OpenAI 兼容 Images API 并保存图片；用户明确指定其他工具或服务时遵从其选择。
---

# Chat to image 调用

本 Skill 所在目录向上三级是项目根。先定位项目根的 `scripts/playground_image.py`，使用 Python 3.10+ 运行；无需启动网页。

1. 先运行项目的 `scripts/playground_config.py` 查看脱敏状态。`source: desktop` 表示项目 `user-config/` 内的共享配置，桌面或本地网页保存后直接使用，无需刷新；尚无共享配置时回退到旧网页同步快照。正常时不附加 `--config`、`--base-url`、`--model` 或 `--api-key-env`，让脚本读取整套配置与主备池。
   配置不可用时按状态消息排查：桌面使用 `run-app.cmd` 的设置入口，本地网页使用 `run-sync.cmd`。不要索要已有 Key 或静默改用其他服务。用户明确指定独立配置时使用 `--config` 或环境覆盖，参数与凭据优先级见接口说明。
2. 将长提示词保存为当前任务的 UTF-8 文件，通过 `--prompt-file` 传入。文本生图无需 `--image`；参考图使用一个或多个 `--image`；局部修改同时传 `--mask`，其透明区域用于修改。
3. 使用同一组参数先运行 `--dry-run`。通过后执行实际请求。默认尺寸 `1k`、质量 `auto`、数量 1；未明确指定导出位置时不传 `--output`，由脚本保存到本机用户目录。提示词临时文件也放在本机用户或临时目录，不在工具/Skill 目录产生用户数据。
4. 读取最终 JSON。以 `ok`、`images`、`warnings` 判断结果；返回所有已保存图片的绝对路径并展示图片。`output_paths` 只是计划路径，dry-run 不代表已生成。
5. 失败时检查 `stage`、`attempted_requests`、`completed_requests`、`request_ids`、`images`。已提交请求可能已计费，先核对服务商状态，勿自动重复提交；批量中的已保存结果仍需交付。

示例（用实际项目和当前任务路径替换占位符）：

```text
python <project-root>/scripts/playground_image.py --prompt-file <user-task-dir>/prompt.txt --size 1k
```

此入口只支持同步非流式 OpenAI 兼容 Images API。配置、参数和排障按需阅读项目根的 [docs/codex-image-interface.md](../../../docs/codex-image-interface.md)。网页历史不与命令行输出自动同步。
