# 网易云定制分支

面向用户的中文说明见 [README_ZH.md](README_ZH.md)；本文件是维护笔记。

本仓库 fork 自 [ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics)，遵循原仓库 LGPL-2.1 许可证。定制代码位于 `netease` 分支，初始基于 v7.0.7。

## 当前功能

- 网易云歌词源：读取 YRC 原生逐字/逐词时间，无 YRC 时使用逐行 LRC。
- 网易云人工翻译源：优先复用歌词源匹配的同一首网易云歌曲，并对齐当前显示的原文。
- QQ 音乐歌词源与人工翻译源：原生 QRC 逐字时间、LRC 回退、移动端/桌面端搜索与分组版本处理，歌词与译文共享同一次歌曲匹配；详见 [协议与接入说明](docs/qqmusic-source.md)。
- 歌词源与翻译源设置页均有配合使用的中文说明。
- 两处翻译缓存读取包含翻译插件版本号，插件升级后跳过旧结果。
- 个人偏好：默认简体中文，非中文歌词的翻译默认值设为开启。已有用户设置可能优先于默认值。

建议歌词与翻译提供商均开启网易云并排在第一位。同源通常更容易对齐，但网易云的数据也可能有缺失或错误，并非每行都有人工翻译。

匹配要求歌名和歌手一致，保留粤语版、现场版等版本标记，再参考专辑和时长挑选。参考 Lyricify 的做法，依次搜索“歌名 歌手 专辑”“歌名 歌手”“歌名”，每次检查前 30 条，前一个搜索没有合格结果才尝试下一个。带专辑搜索能找到排在翻唱和其他语言版本后面的原版：张远《嘉宾》国语原版不带专辑时排第 45 条，带专辑时排第 13 条。版本不符或时长差超过 5 秒时跳过，继续尝试后面的歌词源。网易云歌词缓存版本为 `netease-3`，旧匹配会重新获取。相同元数据仍不能保证同一录音。ivLyrics 的类型优先策略仍可能在网易云只有逐行歌词时选择其他源的逐字歌词。

## QQ 音乐接入

新增 `QQMusicProtocol.js`、`QQMusicRuntime.js`、`Addon_Lyrics_QQMusic.js`、`Addon_AI_QQMusicTranslation.js`。QQ 修改 DES 的解密在浏览器本地完成，zlib 使用内置 `DecompressionStream`，不依赖 .NET 或伴随服务。网易云与 QQ 共用 `HumanLyricsTranslation.js` 的原文/译文分行对齐逻辑；manifest 必须先加载该模块和 QQ 协议运行时。

保留用户的提供商顺序和单曲设置；QQ 人工翻译在 AI 提供商中手动启用。QQ 没有译文时由管理器继续尝试后续翻译提供商。没有迁移 Lyricify 服务器歌词库或人工标记服务。

## 桌面歌词（无需伴随应用）

Spotify 顶栏新增「桌面歌词（画中画）」按钮，点击打开/关闭置顶歌词小窗口。使用 Spotify 自带 Chromium 的 Document Picture-in-Picture，不需要安装独立应用或启动额外服务。

- 灵动岛样式：纯黑横条（600×96），左侧专辑封面（暂停时缩小），中间为当前原文与中文译文，右侧为取自专辑主色的音频律动条。换行时有弹入动画；过长的行先缩小字号放在一行（最小 72%）；仍放不下时原文与译文折行，并按窗口高度整体缩小，避免被裁切。有背景和声的歌词在主唱下方以小一号的行显示。窗口拉高到 150px 以上时会额外显示下一行。
- 鼠标移到右侧律动条处会展开控件：字号 A−/A+、上一首、播放/暂停、下一首，同时显示底部进度条。
- 共用 ivLyrics 的歌词源、单曲歌词源覆盖设置、翻译设置及同步偏移；原生逐字/逐词数据用于连续高亮。无需打开 ivLyrics 页面也会翻译：`LyricsService.getDefaultTranslationMode` 提供与 `index.js` CONFIG 一致的未保存默认值（非中文默认翻译），后台服务和右侧面板不再把未保存的设置当作关闭。
- 播放时自动打开：设置页「常规 → 桌面悬浮窗」和小窗控件里的「自动」按钮是同一个开关（`ivLyrics:desktop:auto-open`）。从暂停变为播放时触发；播放期间手动关掉的窗口要等下次开始播放才会再自动打开。画中画必须由用户操作触发：在 Spotify 里点击或按键开始播放会立即打开；用媒体键或其他设备开始播放时，窗口在下一次点击或按键 Spotify 窗口时打开。
- 除右侧控件区外，按住窗口任意位置都能拖动（`app-region: drag`）。拖动区域收不到鼠标悬停事件，所以控件只在右侧 `no-drag` 区域展开。
- 窗口位置：规范禁止网页移动画中画窗口（已实测 `moveTo` 无效），每次 Spotify 启动后首次打开都在屏幕右下角。拖到顶部后，同一次 Spotify 运行期间关闭再打开会回到该位置；重启 Spotify 后不会保留。
- Spotify 需要保持运行，退出 Spotify 后窗口随之关闭。
- 系统画中画窗口有边框、不透明，不提供鼠标穿透。
- 需要 Spotify 内置浏览器支持 Document PiP；已在 Spotify 1.2.62.580 / Chromium 134 上验证窗口创建、数据读取和时间定位。跨应用置顶及最小化后的连续播放需在本机实际使用中确认。

## 本机安装

- 工作仓库：`D:\projects\ivLyrics`
- `%LOCALAPPDATA%\spicetify\CustomApps\ivLyrics` 是指向工作仓库的目录联接（junction）。
- 原安装目录备份：`%LOCALAPPDATA%\spicetify\CustomApps\ivLyrics.local-backup`
- `origin`：`https://github.com/sounfury/ivLyrics.git`
- `upstream`：`https://github.com/ivLis-Studio/ivLyrics.git`

更改工作仓库后，在 PowerShell 运行以下命令部署（会重启 Spotify）：

```powershell
& "$env:LOCALAPPDATA\spicetify\spicetify.exe" --bypass-admin apply
```

## 跟进官方版本

**不要使用设置页、官方安装脚本或 Marketplace 的官方 ivLyrics 更新操作覆盖此安装。** 它们不会合并定制分支；目录联接也不能阻止更新器覆盖或替换目录。界面中的更新检查仍查询官方版本。

先确认工作区干净，再选择要跟进的官方 tag。示例命令中的版本号需要替换为实际目标版本：

```powershell
Set-Location D:\projects\ivLyrics
git switch netease
git status --short
git fetch upstream --tags
git branch backup/netease-before-update
git merge vX.Y.Z
```

备份分支名应每次换一个。这里使用 merge 保留已发布提交，避免强制推送。若存在冲突，解决后检查网易云插件的 manifest 登记、缓存键和设置说明。未准备好时可运行 `git merge --abort` 回到更新前。

验证通过后再发布和部署：

```powershell
git push origin netease
& "$env:LOCALAPPDATA\spicetify\spicetify.exe" --bypass-admin apply
```

`main` 保留官方历史；日常开发和使用应留在 `netease` 分支。在联接指向的仓库里切换分支，也会改变下一次 apply 使用的源文件。

## 回退

Spotify 当前运行使用的是 apply 后的副本，因此编辑/切换工作仓库后需再次 apply 才会改变运行版本。需要恢复原安装时，先确认链接确为 junction，仅移除链接本身，再将 `ivLyrics.local-backup` 改名为 `ivLyrics` 并 apply。勿对链接执行递归删除，以免误删工作仓库。
