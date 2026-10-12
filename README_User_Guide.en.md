# Chat to image User Guide

[中文](README_使用说明.md) · [Download the latest release](https://github.com/Kenrohoro-hub/Chat-to-image/releases/latest)

## Install and launch

For Windows 10 (1809+) or Windows 11 x64, download `Chat-to-image-VERSION-windows-x64-setup.exe`, run it, and open **Chat to image** from the Start menu. Python and Node.js are included.

The installer is self-signed, so Windows may still show a publisher warning. Download from the project release page. GitHub's **Source code** archive needs a build; see [Run from source](README.en.md#run-from-source).

## Configure and generate your first image

Provide your own API URL, key, and model. Generation and chat use the service you configure and may incur charges.

1. Open **Settings & API → API configuration → Image API profiles**, then add a profile.
2. Enter the service URL and key. Fetch and select an image model, or enter its model ID manually.
3. Enable the profile, set it as primary, and select **Save configuration**.
4. Return to **Create** and choose the model, size, and image count under **Image parameters**.
5. Enter a prompt and select **Generate directly**. Download, favorite, or edit the result.

For conversational creation, also add a **Responses** service under **Chat API profiles** and save it. Select a chat model in Create and send your request. Explicit requests to generate or edit an image use your image service.

## Common tasks

| Task | Action |
| --- | --- |
| Refine text first | Select **Optimize prompt only**, then generate from the reply when ready. |
| Use reference images | Upload, drag, or paste images and explain their roles. Use `@` to refer to a specific image. |
| Edit an image | Select a result and choose **Continue editing**. For a local edit, open the mask editor, mark the area, save, and submit your instructions. |
| Use a library prompt | Choose prompt-only, image-only, or prompt-and-image reuse, then review the draft before generating. |
| Save a prompt | Create a personal prompt or save the current draft in **Prompt library**. Use category management to organize it. |
| Find past work | Open **Recent generations** for images or **Conversation history** for chats. Favorite images you want to keep handy. |
| Change language | Choose a language in **Settings & API → Language**, then select **Save configuration**. Finish or stop tasks and save drafts first. |

Image understanding, web search, transparency, and editing depend on your model. After a timeout or disconnect, check the provider's records before retrying. Stopping locally does not guarantee cancellation or a refund.

## Models and fallback services

Image and chat profiles are separate; save changes before using them. To use fallbacks, add profiles, set their order, and enable automatic switching. Switching applies to clear rejections or missing configuration; uncertain or timed-out requests are not resubmitted automatically.

## Back up and restore

Open **Settings & API → Data management**, select what to include, and export a ZIP. Restore through the ZIP import option. Large backups are split into parts: verify every file downloaded and select all parts from the same batch when importing.

- **Backups that include configuration contain unencrypted API keys. Do not share them publicly.**
- Artwork backups do not include all online prompt catalogs or preloaded images. If you use a custom prompt folder, copy the entire library folder separately.
- Desktop and browser entries store artwork and conversations separately. Export from the original entry and import into the new one.

## Update or move to another computer

Back up important data, close the app, and install the update into the existing folder. Upgrading preserves personal data; uninstalling also leaves configuration and artwork created during use.

On another computer, install the app, enter your API keys again, and import backups. Do not rely on copying `user-config/` to transfer keys: its encryption is tied to the original Windows account.

## Other entry points

- **Local browser:** run `run-sync.cmd` in the installation folder. Use `run-sync.cmd --stay-open` to keep a console where Ctrl+C stops the service created by that launcher.
- **External agents:** connect under **Settings & API → Agent connections**, then reopen the agent session. See the [CLI guide](docs/codex-image-interface.md) for commands.
- **Help:** check the on-screen error first. Include your version, steps, and a redacted screenshot in [GitHub Issues](https://github.com/Kenrohoro-hub/Chat-to-image/issues), without keys or configuration backups.
