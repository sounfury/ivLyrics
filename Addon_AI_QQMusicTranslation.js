/** QQ Music's published Chinese lyric translations; no machine translation. */
(() => {
    'use strict';
    const addon = {
        id:'qqmusic-translation', name:'QQ Music Translation (QQ音乐人工翻译)', author:'local', version:'1.0.0',
        description:{
            en:'Chinese lyric translations published on QQ Music, aligned to the displayed lyrics. No API key required.',
            'zh-CN':'读取 QQ 音乐已有的中文歌词译文，对齐到当前显示的歌词；无需 API 密钥。',
            'zh-TW':'讀取 QQ 音樂已有的中文歌詞譯文，對齊目前顯示的歌詞；不需要 API 金鑰。'
        },
        supports:{translate:true,pronunciation:false,metadata:false,tmi:false,lyricsStudy:false,characterPronunciation:false,culturalAnnotations:false,wordSupplements:false},
        async init() {},
        getSettingsUI() {
            const React=Spicetify.React;
            return function QQMusicTranslationSettings() {
                return React.createElement('div',{className:'ai-addon-settings'},
                    '直接读取 QQ 音乐已有的中文译文，不生成翻译或发音。没有译文或原文无法对齐时，交给后面的翻译提供商。',
                    React.createElement('p',null,'建议与 QQ 音乐歌词源一起使用，确保歌词与译文匹配同一首歌。仅支持中文翻译目标。'));
            };
        },
        async testConnection() {
            const songs=await window.ivLyricsQQMusic.search('Shape of You Ed Sheeran');
            if (!songs.length) throw new Error('QQ Music search returned no songs');
            return true;
        },
        async translateLyrics({text,lang,wantSmartPhonetic,onLine,trackId,title,artist}) {
            if (wantSmartPhonetic) throw new Error('QQ Music Translation does not provide pronunciation');
            if (!/^zh/i.test(String(lang ?? ''))) throw new Error('QQ Music Translation only supports Chinese targets');
            if (!text?.trim() || !title) throw new Error('Lyrics text and track title are required');
            const service=window.ivLyricsQQMusic;
            const match=await service.matchTrack(service.playingTrack(trackId,title,artist));
            if (!match?.entries?.length) throw new Error('QQ Music has no translation for this recording');
            const lines=(await service.simplify(text.replace(/\r\n?/g,'\n'))).split('\n');
            const entryKeys=(await service.simplify(match.entries.map(entry=>entry.key).join('\n'))).split('\n');
            const entries=match.entries.map((entry,index)=>({...entry,key:entryKeys[index]}));
            const {translation,sourceCount,matchedCount}=window.ivLyricsHumanTranslation.alignTranslations(lines,entries);
            if (!sourceCount || matchedCount/sourceCount<0.4) throw new Error(`Only ${matchedCount}/${sourceCount} lines matched QQ Music lyrics`);
            if (typeof onLine==='function') translation.forEach((line,index)=>onLine(index,line));
            return {translation};
        }
    };
    const register=()=>{
        if (!window.AIAddonManager) {setTimeout(register,100);return;}
        window.AIAddonManager.register(addon);
    };
    register();
})();
