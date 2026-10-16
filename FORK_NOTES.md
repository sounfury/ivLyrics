# 网易云定制分支

本仓库 fork 自 [ivLis-Studio/ivLyrics](https://github.com/ivLis-Studio/ivLyrics)，遵循原仓库 LGPL-2.1 许可证。定制代码位于 `netease` 分支，初始基于 v7.0.7。

## 当前功能

- 网易云歌词源：读取 YRC 原生逐字/逐词时间，无 YRC 时使用逐行 LRC。
- 网易云人工翻译源：优先复用歌词源匹配的同一首网易云歌曲，并对齐当前显示的原文。
- 歌词源与翻译源设置页均有配合使用的中文说明。
- 两处翻译缓存读取包含翻译插件版本号，插件升级后跳过旧结果。
- 个人偏好：默认简体中文，非中文歌词的翻译默认值设为开启。已有用户设置可能优先于默认值。

建议歌词与翻译提供商均开启网易云并排在第一位。同源通常更容易对齐，但网易云的数据也可能有缺失或错误，并非每行都有人工翻译。

匹配参考歌名、歌手、专辑和时长；歌词源拒绝时长差超过 5 秒的匹配。不过时长相近不保证同一录音。ivLyrics 的类型优先策略仍可能在网易云只有逐行歌词时选择其他源的逐字歌词。

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
