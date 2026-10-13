# Chat to image

Windows AI 图片生成与编辑工具，支持直接生图、对话创作、参考图和蒙版编辑、提示词库、历史收藏与备份。界面支持中文和英文。

[下载 v0.4.0](https://github.com/Kenrohoro-hub/Chat-to-image/releases/latest) · [使用说明](README_使用说明.md) · [English](README.en.md)

## 安装与配置

支持 Windows 10（1809 起）及 Windows 11 x64。下载 EXE 安装器，双击安装，从开始菜单打开；无需另装 Python 或 Node。

在 **设置与 API → API 配置** 填写服务地址、Key 和模型并保存。直接生图使用 Images 配置，对话创作还需 Responses 配置；API 服务和额度由用户自行提供。

安装器与卸载程序使用自签证书，Windows 可能显示信任提示。升级请选择原安装目录。

## 功能

- 文字生图、多参考图、蒙版修改、多图生成和连续改图。
- 对话优化提示词、图片引用、分支及按模型能力联网；当前结果支持高清查看与左右切换，最近生成可拖入对话。
- 图像与对话 API 分别管理，各最多 10 套，支持模型选择和备用服务。
- 连续工具调用不设次数上限；聊天张数默认沿用生图参数，本次聊天明确指定时优先。
- 45 条内置图文示例、个人分类和七个网络提示词库，支持收藏、引用和预载。
- 作品下载、历史收藏、对话管理、备份导入导出及自定义提示词目录。
- 通过本地 CLI 连接 Codex、Claude Code、Cursor 和 DeepSeek Harness。

操作见 [使用说明](README_使用说明.md)，命令参数见 [CLI 文档](docs/codex-image-interface.md)。

## 从源码启动

准备 Windows、WebView2、Python 3.10+ 和 Node.js LTS（含 npm），下载并解压完整源码：

1. 运行 `build-app.cmd` 构建。
2. 运行 `run-app.cmd` 打开桌面，或 `run-sync.cmd` 打开本地浏览器。

GitHub 源码包不包含 `dist/`，必须先构建。更新源码后关闭应用，再重新构建；构建会更新 `dist/`，不会删除个人配置、作品、对话和备份。

## 数据

API 设置保存在程序目录的 `user-config/`，Key 由当前 Windows 用户加密。桌面和浏览器分别保存作品与对话，迁移请使用导出、导入。

**包含配置的 ZIP 备份含未加密 Key，不要公开分享。** 完整提示词文件库需单独复制保存目录。换电脑后重新填写 Key。

模型能力和费用由服务商决定；超时或断线后先核对服务商记录，再重试。

## 开发

| 命令 | 用途 |
| --- | --- |
| `build-app.cmd` | 构建前端，支持网络共享路径。 |
| `build-app.cmd --test` | 运行前端测试。 |
| `npm run dev` | 前端开发服务。 |
| `npm run mock:api` | [本地接口模拟](docs/mock-image-api.md)。 |
| `build-installer.cmd` | 生成自签安装器，需要 Inno Setup 6 和 PowerShell 7。 |

技术栈：React、TypeScript、Vite、Python、pywebview / WebView2。源码在 `src/` 和 `scripts/`，构建输出在 `dist/`。

## 许可证

[MIT License](LICENSE)。第三方依赖、图片和提示词遵循各自授权。
