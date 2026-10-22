# QQ 音乐歌词与中文翻译

本功能参考 [Lyricify Lyrics Helper](https://github.com/WXRIW/Lyricify-Lyrics-Helper) 的 QQ 音乐协议流程，用 JavaScript 实现并接入 ivLyrics。无需 .NET、额外服务、Cookie 或 API Key。

## 使用

- 在歌词提供商里选择 **QQ Music (QQ音乐)**，可调整到网易云前面，或仅对某首歌指定此源。
- 在 AI 提供商里启用 **QQ Music Translation (QQ音乐人工翻译)**，并将其放在机器翻译前面。这里读取的是 QQ 音乐已有的中文译文，不调用 AI 生成内容。
- 翻译目标应为中文。没有译文、原文对齐不足、请求失败或需要发音时，由 ivLyrics 继续尝试其他可用提供商。
- 新增插件不会重排已保存的提供商顺序，也不会修改已有的单曲歌词源设置。QQ 歌词源遵守歌词管理器的默认启用规则；QQ 翻译需在 AI 提供商列表启用。

## 实现

1. 搜索依次使用“歌名 歌手 专辑”“歌名 歌手”“歌名”，每次检查 30 条候选。
2. QQ Android 搜索接口优先，失败或空结果时尝试 Desktop 接口；展开返回结果中的 `grp` 子版本，并去除搜索高亮标记。复用 ivLyrics 已有 OpenCC 支持将繁体元数据转简体后比较，并展开 `伍佰 & China Blue` 这类合并艺人名称。
3. 歌名、歌手与版本必须符合，已知播放时长时差值不得超过 5 秒。版本写在 QQ 的 `subtitle` 中也参与排除。专辑与时长用于合格候选排序。
4. 按 QQ `id` 请求 `lyric_download.fcg`，分别读取 `content` 原文和 `contentts` 译文。Spicetify 外部请求包装器只解析 JSON，因此 XML 通过用户现有的 `spicetify:corsProxyTemplate` 直接读取原始文本（未配置时使用 Spicetify 默认跨域代理）。不会向 QQ 或代理转发 Spotify 令牌、Cookie。解密后从 QRC XML 的 `LyricContent` 中取出歌词。
5. QRC 使用 QQ 修改过的 DES 组合和 zlib：字节按小端 32 位字排列、后半密钥压缩置换偏移、部分替换表值不同。`QQMusicProtocol.js` 使用独立的位排列实现；标准 3DES 无法直接替代。解压使用 Chromium 原生 `DecompressionStream`，处理密文块补零，并限制输入及解压输出大小。
6. 无 QRC 或译文缺失时，尝试 QQ 的逐行接口，解码 UTF-8 Base64 原文与译文。逐行数据不伪造逐字时间。
7. QQ 歌词源和翻译源共用含 URI、标题、艺人、专辑及播放时长的匹配缓存。失败及空匹配不会永久保留。
8. QQ 译文先按同平台时间戳与原文对应，再由 `HumanLyricsTranslation.js` 对齐到页面文本，保留重复副歌各自的翻译，支持分行和合行。网易云也使用同一个对齐模块。

文件职责：

- `QQMusicProtocol.js`：修改 DES 的 QRC 解密和 zlib 解压。
- `QQMusicRuntime.js`：搜索、匹配、XML/Base64/QRC/LRC 处理及共享请求缓存。
- `Addon_Lyrics_QQMusic.js`：ivLyrics 歌词提供商。
- `Addon_AI_QQMusicTranslation.js`：中文人工译文提供商。
- `HumanLyricsTranslation.js`：人工译文与当前歌词文本对齐。

## 参考与验证

参考 Lyricify 的 [QQMusicSearcher](https://github.com/WXRIW/Lyricify-Lyrics-Helper/blob/master/Lyricify.Lyrics.Helper/Searchers/QQMusicSearcher.cs)、[QQMusic API](https://github.com/WXRIW/Lyricify-Lyrics-Helper/blob/master/Lyricify.Lyrics.Helper/Providers/Web/QQMusic/Api.cs) 和 [QRC 协议实现](https://github.com/WXRIW/Lyricify-Lyrics-Helper/tree/master/Lyricify.Lyrics.Helper/Decrypter/Qrc)。本仓库没有引入其 C# 实现或二进制依赖，协议参数与兼容性数值表按接口所需使用，不改变本仓库许可证。感谢 WXRIW 和 Lyricify 项目公开相关资料。

`tests/fixtures/qqmusic_qrc.json` 使用自造歌词文本，由临时运行的 Lyricify C# 加密实现独立生成密文，验证本实现的兼容性；不打包参考实现。针对性检查：

```shell
node --test tests/qqmusic_provider.test.mjs tests/netease_lyrics_provider.test.mjs
```

实测匿名接口和本机 Spotify 可读取张远《嘉宾》QQ ID `281506863` 的国语逐字歌词、Ed Sheeran《Shape of You》QQ ID `200732335` 的逐字歌词和中文译文，以及伍佰《夢醒時分》QQ ID `1498651` 的正确专辑版逐字歌词。

公开接口可能因地区、网络或服务调整失效；中文译文覆盖不等于全部歌曲都有。原始歌词、译文及时间轴版权归原权利人。此迁移没有接入 Lyricify 的服务器歌词库、人工标记数据库或上传服务。
