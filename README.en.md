# Chat to image

Chat to image is a Windows desktop AI image generation and editing tool. It combines direct generation, conversational creation, prompt management, and artwork organization. Use it in the desktop app, a local browser, or the standalone CLI with image and chat models on APIs you configure.

This independently maintained project is currently at **0.1.0**. See the [project on GitHub](https://github.com/Kenrohoro-hub/Chat-to-image), [GitHub Releases](https://github.com/Kenrohoro-hub/Chat-to-image/releases), the [English User Guide](README_User_Guide.en.md), or the [中文使用说明](README_使用说明.md).

The interface follows the system language by default: Chinese system languages show Chinese, and all other languages show English. The desktop app reads the Windows system UI language; the local browser app reads the browser's primary preferred language. Choose **Settings & API → Language** to select **Follow system**, **中文**, or **English**. This preference is shared with the welcome page for the current entry. Select **Save configuration** to save all current settings drafts, apply the language, and reload the interface. Canceling or closing Settings discards the unsaved language change. You cannot switch while image generation or chat is running; finish or stop those tasks first. If Restore input after restarting is disabled, save or clear input drafts, or enable input restoration before applying another language. Choosing **Follow system** clears the manual selection.

## Features

| Feature | What it supports |
| --- | --- |
| Image generation and editing | Text-to-image, reference images, masked edits, multiple images, and iterative edits. Size, ratio, quality, format, and transparency depend on API capabilities. |
| Conversational creation | Discuss composition, refine prompts, and generate or edit images. Supports image references, conversation branches, stopping responses, and optional web search. |
| API and model management | Separate Images and Responses profiles, up to 10 profiles per group, model discovery, enabled and default models, priority, and automatic failover. |
| Personal prompts | Create, edit, search, favorite, delete, and undo prompts; manage categories; insert prompts into drafts while retaining references and parameters. |
| Online prompt libraries | Browse seven libraries with categories, search, image details, favorites, prompt reuse, cached catalogs, image preloading, removal, and restoration. |
| Prompt library storage | Choose a local folder for prompt text, sources, and preloaded images. The app verifies a copy before switching and keeps the previous data. |
| Artwork and conversations | Search history, manage favorites, download and reuse images, manage conversations, and import or export artwork, conversations, and personal prompts. |
| External agents | Connect Codex, Claude Code, Cursor, and DeepSeek Harness through a local CLI and return generated or edited images as local paths. |
| Interface | Automatic Chinese/English selection, light and dark themes, collapsible sidebar, narrow-screen layouts, and save feedback. |

## Quick start

### Windows standalone installer

Download **Chat-to-image-0.1.0-windows-x64-setup.exe** from [GitHub Releases](https://github.com/Kenrohoro-hub/Chat-to-image/releases), run it, and launch **Chat to image** from the Start menu. It supports Windows 10 version 1809 or later and Windows 11 x64. Python, desktop dependencies, the frontend, and an offline WebView2 installer are included.

The installer excludes personal settings, API keys, artwork, history, and backups. It includes 45 built-in prompts and 45 sample images. Enter your API settings before use. Installation is per-user by default; upgrades should use the existing folder. Uninstalling preserves configuration and artwork created during use. The installer and uninstaller are self-signed. Other computers do not trust the self-signed certificate by default, so Windows may still show a publisher or SmartScreen prompt. The current GitHub 0.1.0 installer does not include the English interface added in this source update.

### Run from source

Source use requires Windows and WebView2, Python 3.10 or later, and a supported Node.js LTS release with npm to build. Node.js is not needed for normal startup if a complete dist directory is present. You must provide an API URL, key, and model. Internet access is needed for setup, API calls, and online prompt libraries.

1. Download and extract the source, or clone https://github.com/Kenrohoro-hub/Chat-to-image.git.
2. Run **build-app.cmd** in the project directory to install dependencies in a local cache and build the frontend.
3. Run **run-app.cmd** to open the desktop app. First launch creates a dedicated Python environment in your user directory and installs desktop components.
4. Open **Settings & API → API profiles**, configure a service, and select **Save**.
5. Direct generation needs an Images profile. Conversational creation also needs a Responses profile.

**GitHub's generated source ZIP does not include the Git-ignored dist directory. Build before the first launch.** After updating source, close the app and run build-app.cmd again.

### Local browser app

With built files present, run **run-sync.cmd**. It starts or reuses the local service and opens a browser. The desktop app, browser app, and CLI share API settings; artwork, history, and conversations are stored separately by desktop or browser. To keep the console open, run **run-sync.cmd --stay-open**, then press Ctrl+C to stop services and tasks created by that entry point.

## API profiles and creation

**Image API profiles** configure image models for direct generation, reference-image editing, and masked edits. **Chat API profiles** configure discussion and prompt refinement; image generation uses an Image API profile. Primary profile, enabled status, fallback order, and automatic failover are managed separately for each group. Save changes before they take effect.

After fetching the model catalog, enable models and choose a default. If a provider has no catalog, enter the model ID manually. Failover is used for recognizable cases such as explicit rejection or incomplete local configuration. Timeouts, disconnects, and unknown acceptance states do not automatically repeat an image request.

Reusing history fills a draft for review. **Use prompt** in an online library also does not generate automatically. Image understanding, web search, reasoning effort, streaming, transparency, and editing parameters depend on the selected model and provider.

## Prompt libraries

Online sources include [Shuixian](https://prompt.qqsrc.com/), [PromptFill](https://promptfill.tanshilong.com/explore), [YouMind](https://youmind.com/zh-CN/nano-banana-pro-prompts), [PixtoAI](https://www.pixtoai.com/styles/), [NanoPrompts GPT-2](https://nanoprompts.org/zh/gpt-image-2), [NanoPrompts](https://nanoprompts.org/zh), and [HeroPrompt](https://heroprompt.sortes.ai/zh).

Catalogs are saved after first load and reused. Failed refreshes keep the existing catalog. Preload current or all category images with progress, cancellation, and resume. Removing a library requires confirmation and preserves other libraries and personal favorites. Restore its entry and refresh to fetch it again.

Under **Settings & API → Data management → Prompt library storage location**, choose a folder and select **Copy and use this location**. The app creates a dedicated “Prompt Library” subfolder for personal prompts, online libraries, categories, sources, and already-preloaded images. Migration does not fetch un-preloaded images and does not overwrite a non-empty destination. By default, prompt libraries use browser storage. A custom folder can be shared by the desktop and local browser apps on the same computer; it does not provide concurrent multi-device synchronization, and manual file edits are not imported.

## External agents and CLI

**Settings & API → Agent connections** provides connect, check, update, and disconnect actions for Codex, Claude Code, Cursor, and DeepSeek Harness. Reopen the agent session after connecting so it can read the integration file.

From the project directory, run **chat-to-image.cmd doctor**, **chat-to-image.cmd agent-guide**, or **chat-to-image.cmd agents status**. The doctor checks the local runtime and redacted configuration; it does not verify keys over the network. See the [CLI interface guide](docs/codex-image-interface.md) for generation and editing parameters. CLI results are saved in local user data by default and are not automatically added to desktop history. Integration uses a local CLI; no MCP service is registered.

## Data, privacy, and backups

| Data | Storage |
| --- | --- |
| API settings, models, priority, and preferences | Shared config under user-config/, encrypted with the current Windows user's DPAPI; Git-ignored. |
| Desktop artwork, history, conversations, runtime data | Local Windows user data. Desktop WebView and each browser's site storage are separate. |
| Prompt catalogs and preloaded images | Browser storage by default, or the selected folder when custom storage is enabled. |
| CLI image output | Local user data by default; an output location can be specified. |
| Manual backups | A location you choose, separate from source code. |

Image and chat requests send prompts, messages, and reference images to your configured API provider. Reading prompt catalogs and preloading images accesses their source websites. Local storage does not mean that models run on your computer.

Git uploads exclude user-config/, local environment configuration, and default outputs/. When making a ZIP manually, exclude these and personal backups. Keep custom prompt libraries outside the project when possible; exported data inside the project may not be covered by existing ignore rules.

After changing computers or Windows accounts, enter your API key again; encrypted settings may not be decryptable in the new environment. Moving the program folder does not move artwork and history. Use export and import to migrate them. Records from the retired Qt app remain in place and are neither imported nor deleted automatically.

Artwork backups can include artwork, conversations, personal prompt text, and links, but not all online catalogs or preloaded images. To back up the complete prompt file library, stop related operations and copy the whole “Prompt Library” folder.

**Selecting “Include configuration” exports API keys and other settings in an unencrypted ZIP. Never upload it to GitHub or share it publicly.**

## Verification and limitations

The project has build and frontend checks, isolated desktop and local-service checks, and browser and filesystem workflow checks. Some checks use mock APIs or images and do not verify every real provider. The native folder picker was simulated; actual device experience, display scaling, other computers, network shares, real agent loading, compatibility, and paid API calls still need checking in target environments. Fixed online sites are supported; arbitrary URLs cannot be added as libraries, and site changes may require an update.

Closing the desktop app stops the local services and task processes it created; standalone CLI calls continue. Stopping a local task does not guarantee that the provider canceled or refunded a request. If the result is uncertain, check the provider's records before retrying.

## Development

The frontend uses React 19, TypeScript, Vite, Zustand, and Tailwind CSS. Local services and the CLI use Python; pywebview and WebView2 provide the desktop window.

| Command | Purpose |
| --- | --- |
| build-installer.cmd | Build the standalone installer in release/ with Inno Setup 6. |
| build-app.cmd | Install frontend dependencies in a local cache, build, and update dist/. |
| build-app.cmd --test | Run frontend tests in the local cache. |
| npm ci | Install dependencies from the lock file. |
| npm run dev | Start the frontend dev server; not equivalent to the desktop app or local service. |
| npm run build | Type-check and build into dist/. |
| npm test | Run Vitest frontend tests. |
| npm run mock:api | Start the local API simulator; see [Mock API guide](docs/mock-image-api.md). |

Frontend source is in src/, local services and CLI in scripts/, and build output is in dist/. Do not edit build output manually. This project uses npm, not yarn or pnpm.

## License

This project uses the [MIT License](LICENSE). Use, modification, commercial use, and distribution are permitted if copyright and license notices are retained. Third-party dependencies, images, and prompts remain subject to their own license or authorization terms.
