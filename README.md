# YouTube Subtitle Sidebar

[简体中文说明](./README.zh-CN.md)

`YouTube Subtitle Sidebar` is a local-only Chrome extension that shows YouTube subtitles in the right sidebar on `youtube.com/watch` pages.

It is designed as a simple MVP:

- no backend
- no audio download
- no ASR
- no server-side processing
- only uses subtitle tracks already exposed by YouTube on the current page

## Features

- Shows subtitles in a custom sidebar beside the YouTube video
- Click a subtitle line to seek the video to that timestamp
- Highlights the current subtitle while the video is playing
- Copies the full subtitle list as `SRT`
- Loads the full transcript when YouTube exposes it
- Uses original subtitle tracks only

## Current behavior

- Works on `https://www.youtube.com/watch*`
- Reads available caption tracks from the current YouTube page
- Falls back to YouTube's built-in transcript panel when direct subtitle payload parsing is unavailable
- If YouTube does not expose a full transcript, it may fall back to live visible-caption capture

## Limitations

- This extension does **not** download video or audio
- This extension does **not** generate subtitles with speech recognition
- Availability depends on whether YouTube exposes subtitle data for the current video
- Some videos may not provide a full transcript
- Auto-translate subtitle flows are intentionally not used in `v1.0.0` because YouTube may rate-limit those requests

## Install from source

1. Open Chrome
2. Go to `chrome://extensions`
3. Turn on `Developer mode`
4. Click `Load unpacked`
5. Select this folder:

```text
/Users/ruska/projects/chrome 插件/字幕插件
```

## Install from release zip

1. Download `youtube-subtitle-sidebar-v1.0.0.zip` from the GitHub Releases page
2. Unzip it locally
3. Open Chrome and go to `chrome://extensions`
4. Turn on `Developer mode`
5. Click `Load unpacked`
6. Select the unzipped folder

## Recommended test videos

- [Example 1](https://www.youtube.com/watch?v=KgiwIEBeOHw)
- [Example 2](https://www.youtube.com/watch?v=X7fz9MXrpV8)

## Project structure

- `manifest.json`: Chrome extension manifest
- `content.js`: main subtitle sidebar logic
- `content.css`: sidebar styles
- `page-bridge.js`: page-context bridge for YouTube player access
- `transcript-trigger.js`: opens YouTube's transcript panel
- `icons/`: extension icons

## Version

Current release: `v1.0.0`
