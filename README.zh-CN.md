# YouTube Subtitle Sidebar

[English README](./README.md)

`YouTube Subtitle Sidebar` 是一个本地运行的 Chrome 插件，用来在 `youtube.com/watch` 页面右侧显示 YouTube 字幕内容。

这是一个偏 `MVP` 的实现，目标是只依赖当前页面里已经暴露出来的字幕数据：

- 不依赖后端
- 不下载音频或视频
- 不做 ASR 语音识别
- 不做服务端处理
- 只使用 YouTube 当前页面已暴露的字幕轨

## 功能

- 在 YouTube 视频右侧插入自定义字幕面板
- 点击某条字幕可跳转到对应播放时间
- 跟随视频播放进度高亮当前字幕
- 支持复制整份字幕为 `SRT`
- 在 YouTube 可提供完整字幕稿时，尽量加载全文字幕
- 当前版本只使用原始字幕轨，不使用自动翻译字幕

## 当前行为

- 仅在 `https://www.youtube.com/watch*` 页面生效
- 从当前页面中读取可用字幕轨
- 当直接解析字幕轨失败时，会回退到 YouTube 自带的 transcript 面板
- 如果 YouTube 没有暴露完整字幕稿，可能会进一步退回到播放器可见字幕的实时捕获

## 限制

- 这个插件**不会**下载视频或音频
- 这个插件**不会**用语音识别生成字幕
- 是否可用取决于 YouTube 是否对当前视频暴露了字幕数据
- 某些视频可能没有完整 transcript
- `v1.0.0` 不使用自动翻译字幕，因为 YouTube 可能会对这类请求进行限流

## 从源码安装

1. 打开 Chrome
2. 进入 `chrome://extensions`
3. 打开右上角 `开发者模式`
4. 点击 `加载已解压的扩展程序`
5. 选择当前目录：

```text
/Users/ruska/projects/chrome 插件/字幕插件
```

## 从 Release zip 安装

1. 在 GitHub Releases 页面下载 `youtube-subtitle-sidebar-v1.0.0.zip`
2. 在本地解压
3. 打开 Chrome，进入 `chrome://extensions`
4. 打开 `开发者模式`
5. 点击 `加载已解压的扩展程序`
6. 选择解压后的目录

## 推荐测试视频

- [Example 1](https://www.youtube.com/watch?v=KgiwIEBeOHw)
- [Example 2](https://www.youtube.com/watch?v=X7fz9MXrpV8)

## 项目结构

- `manifest.json`：Chrome 插件配置
- `content.js`：字幕侧栏主逻辑
- `content.css`：侧栏样式
- `page-bridge.js`：页面上下文桥接逻辑，用于访问 YouTube player
- `transcript-trigger.js`：触发 YouTube transcript 面板
- `icons/`：插件图标

## 版本

当前版本：`v1.0.0`
