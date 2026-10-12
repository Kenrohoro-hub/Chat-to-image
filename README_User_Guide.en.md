# Chat to image User Guide

[English README](README.en.md) · [中文使用说明](README_使用说明.md)

Chat to image is a Windows desktop AI image generation and editing tool. You provide the API address, key, and model; the project does not include an AI service or usage credits. Prompts, messages, and reference images are sent to the API provider you configure when you generate images or chat.

The interface follows the system language by default: Chinese system languages show Chinese, and all other languages show English. The desktop app reads the Windows system UI language; the local browser app reads the browser's primary preferred language. Choose **Settings & API → Language** to select **Follow system**, **中文**, or **English**. This preference is shared with the welcome page for the current entry. Select **Save configuration** to save all current settings drafts, apply the language, and reload the interface. Canceling or closing Settings discards the unsaved language change. You cannot switch while image generation or chat is running; finish or stop those tasks first. If Restore input after restarting is disabled, save or clear input drafts, or enable input restoration before applying another language. Choosing **Follow system** clears the manual selection.

Current version: **0.2.0**. [Project home](https://github.com/Kenrohoro-hub/Chat-to-image) · [Releases](https://github.com/Kenrohoro-hub/Chat-to-image/releases) · [Release notes](RELEASE.md)

## Contents

- [Windows standalone installer](#windows-standalone-installer)
- [Download and launch](#download-and-launch)
- [Configure an API and generate your first image](#configure-an-api-and-generate-your-first-image)
- [Chat creation and image editing](#chat-creation-and-image-editing)
- [Models and fallback services](#models-and-fallback-services)
- [Prompt library](#prompt-library)
- [History and favorites](#history-and-favorites)
- [Save and back up data](#save-and-back-up-data)
- [Update and move to another computer](#update-and-move-to-another-computer)
- [Local browser and external agents](#local-browser-and-external-agents)
- [Troubleshooting](#troubleshooting)
- [Built-in examples and release packages](#built-in-examples-and-release-packages)

## Windows standalone installer

Download Chat-to-image-0.2.0-windows-x64-setup.exe from [GitHub Releases](https://github.com/Kenrohoro-hub/Chat-to-image/releases). It supports Windows 10 version 1809 or later and Windows 11 x64. Run the installer and launch **Chat to image** from the Start menu. You can select a desktop shortcut during installation. Python, desktop components, the built frontend, and an offline WebView2 installer are included, so Python and Node.js are not required. Internet access is not needed to download runtime components during installation. You must provide your own API settings before calling a model service.

The installer uses the current user's application directory by default. Configuration stays in the installation folder under user-config/; artwork and history stay in local user data. The package contains only an application file allowlist and a freshly built dist directory. It excludes personal config, artwork, prompt-library data, logs, agent connection records, and backups while retaining the 45 built-in prompts and 45 sample images. Upgrading in the existing folder preserves data. Uninstall removes application files and shortcuts but preserves user-config/ and user data. Use the app's export/import feature to migrate data.



## Download and launch

### Source prerequisites

| Requirement | Details |
| --- | --- |
| Windows and WebView2 | Required for the desktop window. Install the [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/#download-section) if it is missing. |
| Python 3.10 or later | Install from [python.org](https://www.python.org/downloads/windows/), keeping pip and venv and enabling PATH setup. |
| Node.js and npm | Required only to build from source. Install a supported LTS release from [nodejs.org](https://nodejs.org/); npm is included. |
| Internet access | Needed to install components, call APIs, and read or refresh online prompt libraries. |

Windows x64 users can instead download the standalone installer and skip the source prerequisites.

### Choose your download

| Download | How to use it |
| --- | --- |
| Release attachment: Chat-to-image-0.2.0-windows-x64-setup.exe | Run the installer, then open the app from the Start menu. |
| GitHub Source code ZIP, Download ZIP, or a cloned repository | Extract or clone the full source, run build-app.cmd, then run run-app.cmd. |

Do not launch from inside the archive or copy only the startup scripts. GitHub's generated source archive does not include dist/, so a first-time source setup must build the frontend. The build script installs frontend dependencies in a local cache, builds the app, and updates dist/. It supports Chinese paths and network shares. Do not edit dist/ manually.

At first source launch, the app creates a dedicated Python environment under the local user directory and installs desktop components. Keep the network available and wait for setup to finish. Errors are shown if it fails.

On first launch, you can select **Don't show this introduction automatically** and choose **Get started**. Reopen the introduction under **Settings & API → Feature overview**. **Usage guide** at the top of the creation page opens help by topic.

## Configure an API and generate your first image

### Configure an image service

1. Open **Settings & API → API profiles → Image API profiles**.
2. Select **Add API profile** and enter a name, provider's API URL, and key.
3. Select **Fetch models**, choose an image model, add it, and set a default. If no catalog is provided, enter the model ID manually.
4. Make sure the profile is enabled and primary, then select **Save**.

Enter the URL as specified by the provider, and put the key only in the key field. **Test connection** and **Fetch models** read the model catalog; they do not generate images or chat. A successful catalog read does not verify all model capabilities.

### Generate an image

1. Return to **Create** and open **Image parameters** to choose a model, size, quality, and number of images. Start with one image.
2. Enter a prompt in the bottom input area, for example: “An orange paper airplane on a white background, soft studio lighting, simple composition.”
3. Select **Generate directly**. The prompt and attachments go to the image service without using a chat model.
4. When the result appears, select it to enlarge, download, favorite, or edit it.

Supported sizes and options such as transparency depend on the selected model and provider. Successful images are saved in the current entry point's history; download or back up important work separately.

### Optional: enable chat creation

Under **Settings & API → API profiles → Chat API profiles**, add a chat service that supports the Responses interface. Enter its URL, key, and model, enable it, and save. The chat and image services may use different providers.

Back in **Create**, choose a chat model in the input toolbar. Use **Send** to discuss or refine an idea. When asked to create or edit an image, the assistant can call the configured image service.

## Chat creation and image editing

The left side of **Create** shows the conversation; the right side compares images by turn in the current branch. The top controls switch between **Split view**, **Expand chat**, and **Focus on image**. On narrow screens, switch between chat and image views without losing the draft. Adjust image settings under **Image parameters**; choose a chat model, reasoning effort, and web access in the input toolbar.

| Goal | How to do it |
| --- | --- |
| Discuss or develop an idea | Enter a request and select **Send**. To discuss an image, choose a chat model that supports image understanding. |
| Rewrite a prompt only | Select **Optimize prompt only**. You can choose **Fill input** under the text response, edit it, and submit later. |
| Generate from ready-made text | Select **Generate directly** or **Generate with this prompt** under a response. The text goes to the image API without chat optimization. |
| Add reference images | Upload, drag, or paste images, or reference them from results, history, and prompt details. Use @ to identify images and explain each image's role. |
| Continue editing | Select a result, choose **Continue editing**, and describe what to change and preserve. |
| Edit an area | Select an image, open **Mask editor**, mark the area, save, then describe the edit and submit. |
| Change output settings | Open **Image parameters** and adjust supported size, quality, format, transparency, and image count. |
| Stop a task | Select **Stop**. Completed images are kept. Stopping local work does not guarantee the provider cancels an accepted request. |

Examples: “Change only the coat to red; keep the face, pose, fabric, and background” or “Use image 1 for the person and image 2 only for the style.” Adding an image does not generate anything; attachments are sent when you submit a request.

**Prompt optimization for drawing** is under **Settings & API → Preferences → Chat preferences** and is on by default. It helps the chat assistant clarify edit scope, reference-image roles, and details to preserve. **Allow model to optimize prompt** in image settings controls the image service separately. The effect depends on model capabilities.

The default maximum number of consecutive tool calls is **1**, so images are not iterated automatically. Change it under **Chat preferences → Advanced preferences**. Web access, image understanding, tool calls, and reasoning effort require provider support. If image understanding is unverified, referencing an image does not confirm the chat model received its visual content.

**Current context** above the input shows turns and images in the current branch. Select an image and choose **Start a new chat with this image** to carry over only the selected image, image parameters, and chat preferences. Old chat text, prompts, and masks are not copied. This does not call an API; the old conversation and draft remain.

## Models and fallback services

You can save up to **10 profiles in each group**, including disabled profiles. Image and chat profiles separately manage the primary profile, enablement, fallback order, and **Automatically switch to fallback**. Select **Save** to apply changes. Cancel discards all unsaved profile changes.

After fetching models, search, add selected models, set a default, or remove models. A failed fetch keeps the existing selection. Image parameter limits such as size, quality, format, transparency, and reference-image count can be set according to provider documentation; blank values use general rules.

| Situation | Behavior when automatic failover is enabled |
| --- | --- |
| Primary succeeds | Save the result and record the profile and model used. |
| Primary is missing required settings or explicitly rejects a request | Try available fallback profiles in order. |
| Timeout, disconnect, server error, or unknown result | Stop without automatically resubmitting. |
| Parsing, download, or save fails after a success response | Do not resend the image request. |
| Some images in a batch fail | Keep saved images and show failure details. |

When the image model is **Automatic**, the profile's default model is used. If you choose a model explicitly, a fallback is tried only when it enables the same model ID. Streaming, proxy, and special image profiles marked for independent use do not participate in synchronous Images failover; Responses text streaming can participate in chat failover.

Image services keep failed profiles in cooldown for 5 minutes. View or clear this under **Recent call results**; changing connection settings also clears old cooldowns. Chat services try their own fallback order. Synchronous image batches run at most two images at once and save each as it completes. A save failure stops later submissions.

## Prompt library

### Personal prompts and categories

**Prompt library → Personal prompts** in the sidebar supports creating, searching, editing, favoriting, deleting, and undoing prompts. Select **Save current draft** or **New prompt**, enter a title and content, and choose a category.

There are 45 built-in prompt-and-image examples, including image creation, comics, and AI character art. See each item's details; some mainly provide a reference image. Examples are added on first use. Upgrades add only unseen batches and preserve personal changes. Deleted items from an older batch are not automatically restored.

| Detail action | Effect on the current draft |
| --- | --- |
| **Use prompt** | Replace the text and keep existing reference images and parameters. |
| **Use image** | Add the preview as a reference image and keep the text. |
| **Use prompt and image** | Replace the text and add the preview as a reference image. |

None of these actions generates automatically. Each offers undo; after editing further or switching conversations, the old draft can no longer be restored. An image cannot be referenced if no preview exists. If image loading fails, the original draft is kept. Using prompt alone does not upload the sample image.

Select **Manage categories** to create, rename, or delete categories; at least one category must remain. Drag categories to reorder, or focus one and press **Alt + Up/Down**. Deleting a category moves its prompts to a remaining category shown in the confirmation dialog; prompts are not deleted.

### Online prompts

Choose a site and category to search, page through results, open full prompt text or large images, and reuse a prompt in a draft. Edit variable placeholders as needed; add reference images first when an item requires them. **Favorite** saves the text and source as a personal prompt; selecting it again does not create a duplicate.

Catalogs are cached after first load. Select **Refresh** for new content; a failed refresh preserves the existing catalog. Select **Preload current category** or **Preload all** to save preview images. Progress, cancellation, and resume are supported. Preload scope is not limited by the current page or search; saved images are skipped.

**Clear preloaded data** removes the selected site's catalogs, text, and preview images for every category but keeps personal favorites. **Delete prompt library** also removes the site entry. Restore it under **Deleted libraries**, then refresh to fetch content; old cached data does not automatically return.

Sites and image hosts can change. Preloading may fail; retry later. Image preloading needs the desktop or local browser entry and may be blocked by cross-origin restrictions in a separately hosted static page. Arbitrary URLs cannot be added as libraries.

### Custom storage folder

Open **Settings & API → Data management → Prompt library storage location**, choose a folder or enter a full path, then select **Copy and use this location**. The app creates a dedicated “Prompt Library” subfolder for personal prompts, online catalogs, categories, sources, and already-preloaded images.

The app verifies the copy before switching. A non-empty destination is not overwritten; the previous data is kept by default. When moving from another folder, you can select **Clean up old files after migration**. After confirming both locations, only app-registered files are removed, preferably to the Recycle Bin. Cleanup failure does not prevent use of the new location; the UI reports remaining files.

Migration does not download images that were never preloaded. Stop edits in other windows before migrating. If an old window reports stale data, reopen it. If the folder is temporarily unavailable, restore access and reopen the app; old cache data will not overwrite the folder automatically.

The desktop and local browser app on the same computer can use the same folder. It does not provide multi-device concurrent sync. The app manages these files; manual category edits are not imported. See the next section to back up the library.

## History and favorites

**Recent generations** at the bottom right shows recent tasks; open the full history from its top entry. Preview, download, favorite, add to reference images, reuse prompt and parameters, or delete. Reuse fills a draft and uses the current image profile; it does not submit automatically. Select **Open original conversation** to return to an old chat.

**Conversation history** at the top of Create supports search, rename, deletion, and batch management. **Select all** applies only to current search results. Deleting a conversation keeps its artwork by default; select **Also delete related tasks and images** to remove them too. Active conversations are skipped with a notice.

Image history shows 60 items per page; search and filters cover all history. Selection persists across pages. Check the selected count before deleting. Stop generating tasks first. **Favorites** supports collections; each collection shows its four most recently added distinct images.

## Save and back up data

### Where data is stored

| Data | Storage |
| --- | --- |
| API settings, models, fallback order, preferences | user-config/ in the program folder; keys encrypted with the current Windows user's DPAPI. |
| Desktop artwork, history, conversations | Desktop WebView storage in local user data. |
| Local browser artwork, history, conversations | Current browser site storage, separate from desktop data. |
| Prompts and preloaded images | Current entry's storage by default; selected folder when custom storage is enabled. |
| CLI results | Local user data by default; can specify an output folder. Not automatically added to desktop history. |
| Manual backups | The download or other location you choose, outside the program folder. |

The desktop app, local browser, and CLI share API settings, but **do not share all artwork and conversations**. Settings take effect after saving; other open entries usually update within about five seconds. If another window changed the settings, a stale draft is prevented from overwriting them; reopen settings before editing.

### Export and restore

1. Finish or stop current image and chat tasks. Open **Settings & API → Data management**.
2. Select the desired scope: **Include configuration** and/or **Include artwork, conversations, and personal prompts**.
3. Select **Export selected data**. Large backups are split into multiple files; allow all downloads and check that each ZIP is present.
4. To restore, select the data types to import and choose **Import selected data from ZIP**. Select every part of a split backup from the same batch at once.

**A ZIP exported with “Include configuration” contains API keys and other settings without encryption. Never upload it to GitHub or share it publicly.** Before sharing artwork, exclude configuration and review the selected artwork, conversations, and prompts.

Artwork backups contain personal prompt text, categories, and links, but **not all online prompt catalogs or preloaded images**. To back up the complete prompt file library, stop prompt operations and copy the entire custom “Prompt Library” folder. A saved image link does not guarantee that an image will remain available offline.

**Storage and backup status** shows the current entry, estimated site storage, and recent download requests. Estimates do not include all local files, and a download request does not prove the file was saved. Check backups before clearing browser data, uninstalling, or moving the program.

If **Retry saving conversation** appears, the content remains in the current window. Retry successfully before closing. Force-quitting may lose the latest unsaved text. A local save failure does not automatically resubmit image generation.

## Update and move to another computer

### Update on the same computer

1. Export important artwork, conversations, and personal prompts. Back up a custom prompt folder separately.
2. Stop tasks and close the desktop app. Stop the local browser service if it is running.
3. Update the program files in their existing location. Keep user-config/ and separate backups. Do not delete local user data.
4. For source updates, run build-app.cmd again. For a complete package containing dist/, follow that release's instructions.
5. Run run-app.cmd and check settings, history, and prompts. Update agent connections under **Agent connections** if needed.

Moving the program folder does not move artwork or history; keep the existing location when updating. If encrypted settings cannot be read, do not repeatedly overwrite the original file.

### Move to another computer or Windows account

1. Export needed data from the original entry point. Keep backups safe. When copying program files, skip user-config/, personal output, and private backups.
2. Prepare Python, WebView2, and complete program files on the new computer. Build source distributions first.
3. Enter API URLs, keys, and models again; import artwork backups and migrate the prompt library as needed.
4. Reconnect external agents on the new computer. Before moving the project, disconnect them at the old location; reconnect later to update their local command paths.

Encrypted settings from the old Windows account may not be decryptable. If startup reports that configuration cannot be read, return to the original computer and account or choose **Keep old configuration and reconfigure**. The old file is backed up, and the new config needs fresh keys; history and artwork are not cleared.

Artwork databases from the retired Qt version remain in their original location and are not automatically imported or deleted.

## Local browser and external agents

### Local browser

With dist/ present, run run-sync.cmd to start or reuse the local service and open a browser. Its lifecycle is separate from the desktop window; closing the browser tab does not stop the service.

To keep the console open, run run-sync.cmd --stay-open from the program directory. Press Ctrl+C to stop services and tasks created by this entry point. Reused services and standalone CLI calls are unaffected. A separately hosted static site uses its own browser settings; use this project's local entry points to share API settings across desktop, browser, and CLI.

### External agents and CLI

Open **Settings & API → Agent connections**, choose Codex, Claude Code, Cursor, or DeepSeek Harness, and connect. Reopen the agent session to load the integration file. A ready integration file does not prove that the agent or provider has been tested.

The following read-only checks can be run in the program directory: chat-to-image.cmd doctor, chat-to-image.cmd agent-guide, and chat-to-image.cmd agents status. The doctor checks local setup and redacted config, not API keys over the network. See [CLI interface guide](docs/codex-image-interface.md) for commands, output folders, and custom DeepSeek Harness paths.

The CLI reads the shared image config and runs with the desktop closed. Closing the desktop stops only services and tasks it created. After moving the program or changing computers, reconnect agents or copy the updated local command from the connection page.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| Python not found | Install Python 3.10+, enable PATH, and keep pip and venv. |
| Page or build files are missing | You likely downloaded source. Install Node.js/npm and run build-app.cmd first. |
| First-time component setup failed | Check Python, network, folder permissions, and WebView2 Runtime, then retry. |
| I have an image key but cannot chat | Use **Generate directly**; text chat needs a separate Responses service. |
| Model fetch works but generation fails | Check the model, account quota, API type, and size settings. A catalog does not prove access or capabilities. |
| Saved settings did not take effect | Select **Save**, confirm success, and reopen settings if another window edited them. Submitted tasks keep their original settings. |
| Old config cannot be decrypted | Use the original computer/account or keep the old config and enter settings again. |
| Timeout or uncertain result after closing | Check provider records before retrying; stopping locally does not guarantee cancellation or refund. |
| Online prompt or image failed | Check the network and retry refresh or preload later. Source-site changes may require an app update. |
| Chat or streaming reports a cross-origin error | The provider must allow cross-origin browser requests. Standard synchronous desktop Images requests use the local service. |
| History is missing in another browser or entry | Data is stored separately; export from the old entry and import into the new one. |
| Backup says complete but files are missing | Check the download folder, allow multiple files, and verify all parts. The UI records that downloads were requested. |
| App reports duplicate startup or port conflict | Find an existing window first. Confirm ownership before handling a port conflict; do not terminate unrelated processes. |

Capabilities for image understanding, web access, reasoning, transparency, and editing must be confirmed with the actual provider. Display scaling, computers, and network shares can differ. For help, include reproduction steps, version, and redacted error details in [GitHub Issues](https://github.com/Kenrohoro-hub/Chat-to-image/issues). Do not attach API keys or full config backups.

## Built-in examples and release packages

The project's **45 built-in prompts and 45 sample images** are project resources, not personal data, and may be included in project releases. They appear in **Personal prompts** without changing their status as project resources.

Source packages must retain src/lib/promptExamples.ts, its referenced example data modules, and public/prompt-examples/. Packages with built frontend files must retain the complete dist/ directory, including dist/prompt-examples/. Exclude user-config/, personal artwork, personal prompt edits, backups, runtime logs, and temporary output. Do not ZIP your entire working directory.

This project uses the [MIT License](LICENSE). Third-party dependencies, images, and prompts remain subject to their own license or authorization terms.

### Rebuild the installer as a maintainer

On Windows x64 with Python, Node.js/npm, PowerShell 7, and Inno Setup 6 installed, run `build-installer.cmd` from the project root. It rebuilds the frontend, downloads the official embedded Python runtime and Microsoft's offline WebView2 installer, and uses locked desktop dependencies. The Python archive is verified with SHA-256, and the WebView2 installer is checked for a Microsoft signature. Output is placed in `release/`. For a GitHub Release, provide the EXE, matching `.sha256` file, and `Chat-to-image-signing.cer` public certificate. `package-files.txt` lists the packaged application files for troubleshooting.

Every build recreates the frontend to avoid carrying manually added files from an old `dist/`; run the frontend tests before a full release. Use `--iscc` to specify the compiler or `--cache` to specify the local download cache. Do not put the whole project directory into the installer. Build caches and installers are excluded from Git.

### Installer and uninstaller self-signing

`build-installer.cmd` signs the installer, its temporary setup executable, and the uninstaller. On the first build it creates a dedicated **Chat to image** code-signing certificate in the current Windows user's personal certificate store: RSA 3072-bit, SHA-256, valid for three years, with a non-exportable private key. Later builds reuse the same certificate. The private key is never included in the project, installer, or Git. Signing or verification failure stops the build; the SHA-256 file is generated after final signing.

`release/Chat-to-image-signing.cer` contains only the public certificate and can be provided with the installer. The build does not add it to trusted root or publisher stores. Self-signing helps verify origin and integrity; other computers do not automatically trust the publisher, and SmartScreen prompts may remain. Windows PowerShell may report an untrusted certificate root as `UnknownError`; the build verifies the signer and uses native Windows verification to distinguish that status from a modified file. Trust only certificates whose origin and fingerprint you have checked.

The certificate belongs to the current Windows user and computer. Moving to another computer or reinstalling Windows requires a new signing certificate. An expired certificate prompts for action rather than silently replacing the signing identity. Self-signing currently has no external timestamp, so an expired certificate requires signing again with a valid one. Rebuilding locally does not update existing GitHub Release attachments.
