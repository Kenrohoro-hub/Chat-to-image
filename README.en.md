# Chat to image

A Windows AI image generation and editing tool with direct generation, conversational creation, reference images, masked edits, prompt libraries, history, favorites, and backups. The interface supports Chinese and English.

[Download v0.2.0](https://github.com/Kenrohoro-hub/Chat-to-image/releases/latest) · [User Guide](README_User_Guide.en.md) · [中文](README.md)

## Install and configure

Supports Windows 10 (1809+) and Windows 11 x64. Run the EXE installer and open the app from the Start menu. No separate Python or Node.js installation is required.

Enter your API URL, key, and model in **Settings & API → API configuration**, then save. Direct generation uses Images profiles; conversational creation also requires a Responses profile. Provide your own API service and credits.

The installer and uninstaller are self-signed, so Windows may show a trust warning. Upgrade into the existing installation folder.

## Features

- Text-to-image, multiple references, masked and iterative edits, and batch generation.
- Prompt refinement, image references, conversation branches, and model-supported web search.
- Separate image and chat profiles, up to 10 per group, with model selection and fallback services.
- 45 built-in examples, personal categories, and seven online prompt libraries with favorites, reuse, and preloading.
- Downloads, history, collections, conversations, backups, and custom prompt storage.
- Local CLI connections for Codex, Claude Code, Cursor, and DeepSeek Harness.

See the [User Guide](README_User_Guide.en.md) for operations and the [CLI guide](docs/codex-image-interface.md) for command parameters.

## Run from source

Prepare Windows, WebView2, Python 3.10+, and Node.js LTS with npm. Download and extract the complete source:

1. Run `build-app.cmd` to build.
2. Run `run-app.cmd` for the desktop app or `run-sync.cmd` for a local browser.

GitHub source archives do not include `dist/`; build before starting. Close the app and rebuild after source updates.

## Data

API settings are stored in `user-config/` in the program folder; keys are encrypted for the current Windows user. Desktop and browser entries store artwork and conversations separately. Use export and import to move data.

**Configuration ZIP backups contain unencrypted keys. Do not share them publicly.** Back up the complete prompt file library separately. Enter keys again when moving to another computer.

Model capabilities and fees depend on your provider. Check provider records before retrying a timed-out or disconnected request.

## Development

| Command | Purpose |
| --- | --- |
| `build-app.cmd` | Build the frontend; supports network shares. |
| `build-app.cmd --test` | Run frontend tests. |
| `npm run dev` | Start frontend development. |
| `npm run mock:api` | [Run the local API simulator](docs/mock-image-api.md). |
| `build-installer.cmd` | Build a self-signed installer; requires Inno Setup 6 and PowerShell 7. |

Stack: React, TypeScript, Vite, Python, pywebview / WebView2. Sources are in `src/` and `scripts/`; build output is in `dist/`.

## License

[MIT License](LICENSE). Third-party dependencies, images, and prompts retain their respective licenses.
