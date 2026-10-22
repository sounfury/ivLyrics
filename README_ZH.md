[한국어](README.md) · [English](README_EN.md) · 简体中文（网易云分支）

# ivLyrics · 网易云分支

这是 [ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics) 的非官方分支，面向中文听众，**定制内容都在 `netease` 分支上**。ivLyrics 是 Spotify 桌面版的 Spicetify 歌词扩展，可以同时显示原文、发音和翻译。本分支在它的基础上增加了网易云歌词、网易云人工翻译和不需要额外安装程序的桌面歌词。

原版的完整功能介绍见 [官方 README](README.md)（[English](README_EN.md)）。本页只说明这个分支改了什么、怎么安装。

## 本分支新增

### 网易云歌词源

- 读取网易云 YRC 逐字/逐词时间轴，逐字高亮更准；没有 YRC 时使用逐行 LRC。
- 要求歌名和歌手匹配，保留粤语版、现场版等版本标记，再参考专辑和时长挑选；版本不符或时长相差超过 5 秒时跳过，继续尝试后面的歌词源。

### 网易云人工翻译

- 翻译提供商里新增「NetEase Translation（网易云人工翻译）」，直接使用网易云用户上传的人工译文，不调用 AI，也不需要 API Key。
- 优先使用与歌词源同一首网易云歌曲的译文，并对齐到当前显示的每一行。网易云没有译文时，交给列表中的下一个翻译提供商。
- 仅在翻译目标语言为中文时生效。

### 桌面歌词（灵动岛样式）

- Spotify 顶栏新增「桌面歌词（画中画）」按钮，点击后打开一个置顶的小窗口，可以浮在其他程序上方。
- 使用 Spotify 内置浏览器的画中画（Document Picture-in-Picture），**不需要安装额外程序**。
- 黑色横条样式：左侧是专辑封面，中间是当前歌词和译文，右侧是随音乐跳动的波形条。支持逐字高亮，太长的歌词会自动缩小或折行，始终完整显示在窗口内；背景和声显示在主唱下方。
- 鼠标移到右侧波形条上会展开控件：调整字号、上一首、播放/暂停、下一首，以及「自动」开关。
- 按住窗口任意位置（右侧控件区除外）可以拖动。
- **播放时自动打开**：在窗口的「自动」按钮，或设置「常规 → 桌面悬浮窗」中开启。在 Spotify 里点击播放时会立即打开；用媒体键或手机遥控开始播放时，由于浏览器要求先有一次用户操作，窗口会在你下一次点击 Spotify 时打开。
- 不打开 ivLyrics 页面，桌面歌词也会按你的翻译设置显示译文。

已知限制：

- 窗口必须由浏览器决定位置，网页无法移动它。每次启动 Spotify 后第一次打开都在屏幕右下角；拖到别处后，在本次 Spotify 运行期间会记住位置。
- 窗口不透明、不能点击穿透；退出 Spotify 后窗口也会关闭。
- 需要 Spotify 内置浏览器支持画中画，已在 Spotify 1.2.62 上验证。

### 其他

- 第一次加载时界面语言会切换为简体中文（只切换一次，之后可以在设置里改回）。
- 非中文歌曲默认开启翻译；已经保存过的翻译设置不受影响。

## 安装

需要先安装 Spotify 桌面版和 [Spicetify](https://spicetify.app/docs/getting-started)。

1. 找到 Spicetify 的 `CustomApps` 目录：
   - Windows：运行 `spicetify -c`，`CustomApps` 在显示的 `config-xpui.ini` 旁边（通常是 `%LOCALAPPDATA%\spicetify\CustomApps`）。
   - macOS / Linux：通常是 `~/.config/spicetify/CustomApps`。
2. 把本分支克隆为 `CustomApps` 下的 `ivLyrics` 文件夹（已装过官方版的，先把旧的 `ivLyrics` 文件夹改名备份）：

   ```shell
   git clone -b netease https://github.com/sounfury/ivLyrics.git ivLyrics
   ```

3. 启用并应用：

   ```shell
   spicetify config custom_apps ivLyrics
   spicetify apply
   ```

### 推荐设置

在 **歌词提供商** 中启用「NetEase（网易云音乐）」，在 **AI 提供商** 中启用「NetEase Translation（网易云人工翻译）」，并把两者都拖到第一位。歌词和翻译来自同一首网易云歌曲时，最容易对齐。

网易云的数据也可能缺失或有错，并不是每一行都有人工翻译；需要时可以在它后面再排一个 AI 翻译提供商兜底。

## 更新

在 `ivLyrics` 文件夹中运行：

```shell
git pull
spicetify apply
```

> **不要使用 ivLyrics 设置里的「检查更新/更新」按钮，也不要运行官方安装脚本。** 它们会下载官方版本覆盖本分支，网易云和桌面歌词功能都会消失。界面里显示的「有新版本」指的是官方版本。

本分支会定期合并官方新版本。

## 许可与致谢

- 原项目：[ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics)，感谢原作者和贡献者。
- 本分支与原作者无关，问题请在本仓库提 issue，不要反馈到官方仓库。
- 与原项目相同，使用 [LGPL-2.1](LICENSE) 许可证。
- 网易云相关功能使用网易云音乐的公开接口，歌词与译文版权归原权利人所有。
