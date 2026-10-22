/** QQ Music QRC/LRC lyrics source for ivLyrics. @addon-type lyrics */
(() => {
    'use strict';
    const CACHE_VERSION = 'qqmusic-1';
    const addon = {
        id: 'qqmusic', name: 'QQ Music (QQ音乐)', author: 'local', version: '1.0.0', cacheVersion: CACHE_VERSION,
        description: {
            en: 'QQ Music native word/character-synced QRC lyrics, with line-synced LRC fallback. No API key required.',
            'zh-CN': 'QQ 音乐原生逐字/逐词 QRC 歌词；无逐字数据时回退逐行 LRC。无需 API 密钥。',
            'zh-TW': 'QQ 音樂原生逐字/逐詞 QRC 歌詞；無逐字資料時使用逐行 LRC。不需要 API 金鑰。'
        },
        supports: {karaoke:true, karaokeCharacter:true, karaokeWord:true, synced:true, unsynced:true},
        supportsLocalTracks: true,
        async init() {},
        getSettingsUI() {
            const React = Spicetify.React;
            return function QQMusicSettings() {
                return React.createElement('div', {className:'ai-addon-settings'},
                    '使用 QQ 音乐 QRC 原生逐字时间轴，无 QRC 时使用逐行歌词。歌名、歌手及版本必须匹配，已知时长相差超过 5 秒时跳过。',
                    React.createElement('p', null, '配合「QQ Music Translation（QQ音乐人工翻译）」可复用同一首歌的中文译文。接口可能受网络、地区或服务调整影响。'));
            };
        },
        async getLyrics(info) {
            const result = {uri:info?.uri || '', provider:'qqmusic', cacheVersion:CACHE_VERSION,
                karaoke:null, synced:null, unsynced:null, karaokeSource:null, copyright:null, error:null};
            if (!info?.title) return {...result,error:'Missing track metadata'};
            try {
                const match = await window.ivLyricsQQMusic.matchTrack({...info,durationMs:Number(info.duration) || 0});
                if (!match) return {...result,error:'No confident QQ Music match'};
                if (match.karaoke.length) { result.karaoke=match.karaoke; result.karaokeSource='qqmusic-qrc'; }
                if (match.synced.length) {
                    result.synced=match.synced;
                    result.unsynced=match.synced.map(({text}) => ({text}));
                }
                result.qqmusic={songId:match.song.id,songMid:match.song.mid,name:match.song.title || match.song.name,album:match.song.album?.name || ''};
                if (!result.karaoke && !result.synced) result.error='QQ Music has no lyrics';
                return result;
            } catch (error) {
                window.__ivLyricsDebugLog?.('[QQ Music Lyrics]',error.message);
                return {...result,error:error.message || 'QQ Music request failed'};
            }
        }
    };
    const register = () => {
        if (!window.LyricsAddonManager) { setTimeout(register,100); return; }
        window.LyricsAddonManager.register(addon);
    };
    register();
})();
