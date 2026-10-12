# Agent Instructions for Chat to image

本文件定义 AI 编码助手在此仓库中应遵循的工作方式。

## 项目概况

- 正式 Windows 桌面恢复 React 19 + Vite + TypeScript 网页界面，由 Python + pywebview / WebView2 承载；入口 `run-app.cmd` → `scripts/desktop_app.pyw` → `scripts/desktop_host.py`，本地服务仅监听回环地址并随窗口关闭。
- `build-app.cmd` 将前端同步到本机构建缓存并更新 `dist/`，支持中文和网络共享路径。桌面检查使用 `python -B scripts/test_desktop_startup.py`、`python -B scripts/test_desktop.py`，前端使用构建及 Vitest；测试隔离配置和作品，不调用收费服务。
- `scripts/native_*.py` 为退出正式使用的 Qt 实现，保留用于读取 Qt 阶段作品和备份；不得自动删除其 SQLite 库或用户图片，不再作为默认启动链。`run-legacy-export.cmd` 仍打开同一 Web 桌面历史入口。
- 源码在 `src/`，构建产物由 Vite 生成，不要手动编辑 `dist/`。
- 发布打包按 `README_使用说明.md` 的“内置示例与发布包”说明区分项目资源与个人资料；项目自带的默认提示词和展示图应随包保留，不得按个人资料排除。
- `build-installer.cmd` 使用系统 Inno Setup 6 生成 `release/` 的 Windows x64 独立安装器；按白名单收集程序并重新构建前端，附带 Python 与 WebView2 离线组件。保留内置示例，严禁收集 `user-config/`、作品、日志和用户备份；安装器改动运行 `scripts/test_installer.py` 与 `scripts/test_desktop_startup.py`，实际安装/升级/卸载使用隔离测试目录。
- 安装器与卸载程序通过 `scripts/sign_installer.ps1` 自签，复用当前 Windows 用户证书库中的专用不可导出私钥；只发布 CER 公钥，禁止导出私钥或自动修改根信任库。签名改动还需设置 `CHAT_TO_IMAGE_SIGNING_THUMBPRINT` 后运行安装器篡改检查，并验证隔离安装生成的卸载程序；使用限制见使用说明“安装器与卸载程序自签名”。
- 包管理器为 npm（有 `package-lock.json`），不要使用 yarn 或 pnpm。

## Codex 图片调用入口

桌面、本地网页和 Codex 共用项目 `user-config/` 内的加密配置，该目录排除 Git。历史、作品、运行环境和默认 CLI 输出保留本机用户目录；复制工具时跳过 `user-config/` 和用户备份。持久化、换机与隔离规则见 `README_使用说明.md`。

开发期间改代码和构建必须保留用户已填写的 `user-config/` 及本机数据，开发完毕由用户自行删除个人配置。测试使用隔离的假配置，仅清理本任务创建的测试数据。

generate-playground-image 技能已按用户要求卸载。用户明确要求通过本项目生图或编辑图片时，使用 `chat-to-image.cmd` / `scripts/chat_to_image.py`：先读取 `agent-guide`，再调用 `generate`，复用 `scripts/playground_image.py` 及桌面共享配置；没有桌面配置时读取旧网页同步快照。外部 Agent 接入由桌面“设置与 API → Agent 连接”或 `agents` 子命令管理，完整参数与保护边界见 `docs/codex-image-interface.md`。本次任务状态以 `tasks/plan.md` 为唯一入口。CLI 或连接管理改动运行 `python -B scripts/test_chat_to_image.py` 和 `python -B scripts/test_agent_connections.py`；桌面配置或主备改动运行 `python -B scripts/test_desktop.py`；生图执行器改动运行 `python -B scripts/test_playground_image.py`。配置同步改动还需运行 `python -B scripts/test_playground_sync.py` 和 `node --test scripts/test-playground-bridge.mjs`。

## 常用命令

| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 开发服务器 | `npm run dev` |
| 构建 | `npm run build` |
| 运行测试 | `npm test` |
| 监听测试 | `npm run test:watch` |

- 测试使用 Vitest，已有多个 `*.test.ts` 文件。
- 不要新增 lint/formatter 配置文件，除非明确要求。

## 代码风格（强制）

### 简单优先

写出能工作的**最简代码**。少抽象、少包装。有疑问就内联。

- 不要为单次使用的 1-5 行逻辑创建独立函数，直接内联。
- 函数只有在**多处调用**且**逻辑非平凡**时才值得提取。
- 不要引入项目中不存在的设计模式或架构层。

### 完整实现

- 不要留 `// TODO: implement later`、`// ...` 或 stub 函数。
- 如果不确定某个细节，给出完整的最佳猜测实现。错误但完整的代码优于正确但残缺的骨架。

### 跟随现有风格

这是最高优先级规则。修改文件时，遵循该文件及周围代码的已有风格。

### 格式

- **2 空格缩进**。
- **单引号**（`'hello'`）。
- **无分号**。
- 箭头函数始终加括号：`(x) => x`。
- 行宽不做硬性限制，但尽量保持可读。

### TypeScript

- 使用 ESM import，`const` 优先，永远不用 `var`。
- Target `ES2020`（见 `tsconfig.json`）。
- 优先早返回，避免深层嵌套和 `else` 链。
- 尽量避免 `any`；需要时保持局部化。
- 利用类型推断，不写多余的类型注解。
- 共享类型放 `src/types.ts`，局部类型放文件顶部。

### 命名

- **PascalCase**：组件、类型、接口。
- **camelCase**：函数、变量、参数。
- **UPPER_SNAKE_CASE**：模块级常量。
- 文件名小写驼峰：`apiProfiles.ts`、`maskPreprocess.ts`。
- 局部变量优先短名：`ctx`、`el`、`msg`、`idx`、`opts`、`err`。多词名仅在单词不够清晰时使用。

### 解构

避免无必要的解构。优先点号访问以保留上下文。

```ts
// 好
profile.baseUrl
opts.settings

// 避免
const { baseUrl } = profile
const { settings } = opts
```

例外：React 组件 props、hooks 返回值、函数参数解构是可以的。

### 控制流

```ts
// 好：早返回
function getPreset(name: string) {
  if (!name) return defaultPreset
  return presets.find((p) => p.name === name)
}

// 避免：多余的 else
function getPreset(name: string) {
  if (!name) return defaultPreset
  else return presets.find((p) => p.name === name)
}
```

### 变量

优先 `const`，用三元或早返回代替 `let` 重赋值。

```ts
// 好
const params = hasInputImages
  ? { ...baseParams, image: inputImages }
  : baseParams

// 避免
let params
if (hasInputImages) params = { ...baseParams, image: inputImages }
else params = baseParams
```

### 常量提取

不要为一次性使用的字面量定义命名常量。只有满足以下条件之一才提取：
1. 多处使用，或
2. 含义不一目了然，或
3. 是需要调优的关键参数。

### 防御性代码

本项目涉及外部 API 响应、URL 参数、IndexedDB 持久化数据——对这些**外部输入**保留必要的校验和兼容处理（`normalize*`、`ensure*` 等函数在本项目中是合理的）。

但不要对已声明为非可选的内部类型加投机性空检查。

## Import 顺序

大致分组：
1. React / React DOM
2. 第三方包（zustand、fflate、react-markdown 等）
3. 本地类型（`../types`、`./types`）
4. 本地模块（`./lib/*`、`./hooks/*`、`./components/*`）

## React 组件

- 函数组件 + hooks，不使用 class 组件。
- 组件文件放 `src/components/`，hooks 放 `src/hooks/`，工具函数放 `src/lib/`。
- 复杂 UI 逻辑可以拆成独立组件或 hook，不必强行内联。
- Tailwind 类名不强制排序，但同类属性（布局、间距、颜色、交互）尽量分组书写，保持可读。

## 错误处理

- 对网络请求和文件 I/O 使用 `try/catch`，用 `console.warn` 或 `console.error` 记录。
- 不要对没有证据会失败的路径加投机性错误处理。

## 注释与语言

- 代码注释使用**中文**，与项目现有风格保持一致。
- UI 文案默认中文。
- 注释应简洁，说明"为什么"而非"做了什么"——除非逻辑复杂不易一眼看出。

## 发布版本升级

- 准备新版本时，先检查当前分支相对远端的全部未推送提交和未提交修改，再据此编写 `RELEASE.md`。
- `RELEASE.md` 使用实际发布日期，只记录最终面向用户的新增、变更和修复；不要记录开发新内容时产生的中间调整或配套修复。
- `RELEASE.md` 格式：
  - 标题使用 `## v版本号（YYYY-MM-DD）`，日期括号使用中文全角括号。
  - 内容按需使用 `### 新增`、`### 变更`、`### 修复`、`### 贡献` 分类，没有内容的分类不要保留。
  - 每项使用 `- ` 开头，以完整中文句子概括用户可感知的结果，句末使用中文句号。
  - 相关 PR 或 Issue 编号放在条目末尾，格式为 `（PR #42）` 或 `（Issue #42）`，与已有发布记录保持一致。
  - 外部贡献在 `### 贡献` 中使用 `- @用户名 通过 PR #编号 贡献了……，特此感谢。` 格式致谢。
- 提升版本号时必须同步更新以下位置：
  - `package.json` 的 `version`。
  - `package-lock.json` 顶层及根包的 `version`。
  - `public/sw.js` 的 `CACHE_NAME` 版本，确保旧缓存能够在 Service Worker 激活时清理。
  - `RELEASE.md` 标题中的版本号和日期。
- 更新后全局搜索旧版本号，确认没有遗漏仍需同步的位置；历史发布记录中的旧版本号不需要修改。
- 发布前运行 `npm run build` 和 `npm test`，并复查最终差异。

## 架构约束

- 新增纯函数或工具逻辑时，放 `src/lib/` 而非 `src/store.ts`。store 文件已过大，应只包含 state 定义和 action 入口。
- 避免在多处重复定义相同工具函数（如 `blobToDataUrl`），优先复用 `src/lib/` 中已有导出。
- 新增较大功能时，优先拆成独立模块（lib 函数 + hook + 组件），而非全部塞进现有大文件。
- 组件超过 800 行时，考虑按逻辑边界拆成子组件或自定义 hook。

## 注意事项

- `src/store.ts` 是核心状态文件（5000+ 行），修改时注意：
  - 持久化逻辑和数据迁移（`persist` middleware + IndexedDB）。
  - 模块顶部的 `normalize*` 函数用于从 IndexedDB/localStorage 恢复时清洗旧格式数据，修改需保持向后兼容。
  - 新增 state 字段时，考虑是否需要持久化以及升级路径。
- `src/lib/apiProfiles.ts` 包含多供应商配置，修改时注意向后兼容。
- `src/lib/db.ts` 是 IndexedDB 封装层，修改 schema 时需升级 `DB_VERSION` 并处理 `onupgradeneeded`。
- 修改完成后优先运行 `npm run build` 验证编译，再运行 `npm test` 验证测试。
