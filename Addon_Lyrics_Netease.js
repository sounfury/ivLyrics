/**
 * NetEase Cloud Music Lyrics Provider Addon for ivLyrics
 * Reads NetEase's syllable-timed lyrics (YRC, the same data Lyricify uses) and
 * falls back to its line-synced LRC. The match is picked by title, artist,
 * album and duration so the timing belongs to the recording being played.
 * The NetEase Translation addon reuses this match, keeping original lines and
 * translations from the same NetEase song.
 *
 * @addon-type lyrics
 * @id netease
 * @name NetEase (网易云音乐)
 * @version 1.0.0
 * @author local
 * @supports karaoke: true
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    const CACHE_VERSION = 'netease-1';
    const ADDON_INFO = {
        id: 'netease',
        name: 'NetEase (网易云音乐)',
        author: 'local',
        version: '1.0.0',
        cacheVersion: CACHE_VERSION,
        description: {
            ko: 'NetEase Cloud Music의 글자 단위(YRC) 및 줄 단위 싱크 가사',
            en: 'Syllable-synced (YRC) and line-synced lyrics from NetEase Cloud Music',
            ja: 'NetEase Cloud Music の文字単位（YRC）・行単位の同期歌詞',
            'zh-CN': '网易云音乐的逐字（YRC）与逐行歌词',
            'zh-TW': '網易雲音樂的逐字（YRC）與逐行歌詞'
        },
        supports: {
            karaoke: true,
            karaokeCharacter: true,
            karaokeWord: true,
            synced: true,
            unsynced: true
        },
        supportsLocalTracks: true,
        icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5a1 1 0 0 1 1 1v3.6l2.7 1.6a1 1 0 1 1-1 1.7l-3.2-1.9a1 1 0 0 1-.5-.9V8.5a1 1 0 0 1 1-1z'
    };

    const SEARCH_URL = 'https://music.163.com/api/search/get?limit=10&type=1&s=';
    const LYRIC_URL = 'https://music.163.com/api/song/lyric/v1?lv=-1&kv=-1&tv=-1&rv=-1&yv=-1&ytv=-1&yrv=-1&id=';
    const REQUEST_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0',
        Referer: 'https://music.163.com/'
    };
    // A larger gap means NetEase matched another recording (live, edit, ...),
    // whose timing would drift away from the track being played.
    const MAX_DURATION_DIFF_MS = 5000;
    const MATCH_CACHE_LIMIT = 30;
    const CREDIT_LINE = /^\s*(作词|作曲|编曲|词|曲|制作人?|监制|混音|母带|和声|录音|吉他|贝斯|鼓|弦乐|出品|发行|企划|统筹|op|sp|lyricist|lyrics|composer|music|arranger|producer|mix(ed)?|master(ed|ing)?)\s*(by)?\s*[:：]/i;
    const PURE_MUSIC = /纯音乐[，,]?\s*请欣赏/;

    async function requestJson(url) {
        if (typeof Spicetify !== 'undefined' && Spicetify.CosmosAsync) {
            try {
                const result = await Spicetify.CosmosAsync.get(url, null, REQUEST_HEADERS);
                return typeof result === 'string' ? JSON.parse(result) : result;
            } catch (error) {
                window.__ivLyricsDebugLog?.('[NetEase Lyrics] CosmosAsync failed, retrying with fetch:', error?.message);
            }
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`NetEase HTTP ${response.status}`);
        return response.json();
    }

    function normalizeText(text) {
        return String(text ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[’‘`´]/g, "'")
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function cleanTitle(title) {
        return String(title ?? '')
            .replace(/\s*[([（【][^)\]）】]*(feat|ft\.|with|remaster|version|ver\.|live|edit|mix|from|bonus)[^)\]）】]*[)\]）】]/gi, '')
            .replace(/\s+-\s+.*(remaster|version|live|edit|mix|from).*$/i, '')
            .trim();
    }

    function scoreSong(song, { title, artist, album, durationMs }) {
        const wantedTitle = normalizeText(cleanTitle(title));
        const wantedArtists = String(artist ?? '').split(/[,&、]|\s+feat\.?\s+/i).map(normalizeText).filter(Boolean);
        let score = 0;

        const name = normalizeText(cleanTitle(song.name));
        if (name === wantedTitle) score += 4;
        else if (name && wantedTitle && (name.includes(wantedTitle) || wantedTitle.includes(name))) score += 2;

        const songArtists = (song.artists || []).map(a => normalizeText(a.name));
        if (wantedArtists.some(a => songArtists.some(s => s === a || s.includes(a) || a.includes(s)))) score += 3;
        if (album && normalizeText(song.album?.name) === normalizeText(album)) score += 2;

        if (durationMs) {
            const diff = Math.abs(durationMs - song.duration);
            if (diff < 3000) score += 3;
            else if (diff > 15000) score -= 3;
        }
        return score;
    }

    // Shared with the NetEase Translation addon: trackKey -> Promise<{ song, lyric }>
    const matchCache = new Map();

    function getTrackKey(info) {
        return info?.uri || `${info?.title}::${info?.artist}`;
    }

    async function searchSong(info) {
        const queries = [`${cleanTitle(info.title)} ${info.artist ?? ''}`.trim(), cleanTitle(info.title)];
        for (const query of [...new Set(queries)]) {
            const songs = (await requestJson(SEARCH_URL + encodeURIComponent(query)))?.result?.songs;
            if (!songs?.length) continue;
            let best = null;
            let bestScore = 0;
            for (const song of songs) {
                const score = scoreSong(song, info);
                if (score > bestScore) {
                    best = song;
                    bestScore = score;
                }
            }
            // Require a title or artist match on top of any duration bonus.
            if (bestScore >= 5) return best;
        }
        return null;
    }

    function matchTrack(info) {
        const key = getTrackKey(info);
        if (matchCache.has(key)) return matchCache.get(key);

        const promise = (async () => {
            const song = await searchSong(info);
            if (!song) return null;
            const lyric = await requestJson(LYRIC_URL + song.id);
            window.__ivLyricsDebugLog?.(`[NetEase Lyrics] Matched "${song.name}" (${song.id}) for ${key}`);
            return { song, lyric };
        })();

        matchCache.set(key, promise);
        if (matchCache.size > MATCH_CACHE_LIMIT) matchCache.delete(matchCache.keys().next().value);
        promise.catch(() => matchCache.delete(key));
        return promise;
    }

    function isSkippableLine(text) {
        return !text || CREDIT_LINE.test(text);
    }

    // YRC line: [lineStart,lineDuration](wordStart,wordDuration,0)word(...)word
    // Credit lines are JSON objects ({"t":0,"c":[...]}) and are skipped.
    function parseYrc(yrc) {
        const lines = [];
        for (const raw of String(yrc ?? '').split('\n')) {
            const head = raw.match(/^\[(\d+),(\d+)\]/);
            if (!head) continue;
            const body = raw.slice(head[0].length);
            const stamps = [...body.matchAll(/\((\d+),(\d+),-?\d+\)/g)];
            const syllables = [];
            stamps.forEach((stamp, index) => {
                const end = index + 1 < stamps.length ? stamps[index + 1].index : body.length;
                const text = body.slice(stamp.index + stamp[0].length, end);
                if (!text) return;
                const startTime = Number(stamp[1]);
                syllables.push({ text, startTime, endTime: startTime + Math.max(1, Number(stamp[2])) });
            });
            if (!syllables.length) continue;

            syllables[0].text = syllables[0].text.trimStart();
            syllables[syllables.length - 1].text = syllables[syllables.length - 1].text.trimEnd();
            const text = syllables.map(s => s.text).join('').trim();
            if (isSkippableLine(text)) continue;

            const startTime = Number(head[1]);
            lines.push({
                startTime,
                endTime: Math.max(startTime + Number(head[2]), syllables[syllables.length - 1].endTime),
                text,
                syllables: syllables.filter(s => s.text)
            });
        }
        return lines.sort((a, b) => a.startTime - b.startTime);
    }

    function parseLrc(lrc, durationMs) {
        const lines = [];
        for (const raw of String(lrc ?? '').split('\n')) {
            const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
            if (!stamps.length) continue;
            const text = raw.replace(/\[[^\]]*\]/g, '').trim();
            if (isSkippableLine(text)) continue;
            for (const stamp of stamps) {
                lines.push({ startTime: Math.round((Number(stamp[1]) * 60 + Number(stamp[2])) * 1000), text });
            }
        }
        lines.sort((a, b) => a.startTime - b.startTime);
        lines.forEach((line, index) => {
            const next = lines[index + 1]?.startTime;
            line.endTime = Math.max(line.startTime + 1, next ?? (durationMs || line.startTime + 3000));
        });
        return lines;
    }

    function getText(key, fallback) {
        const lang = window.I18n?.getCurrentLanguage?.() || 'en';
        return (TEXT[lang] || TEXT[lang.split('-')[0]] || TEXT.en)[key] || fallback;
    }

    const TEXT = {
        'zh-CN': {
            title: '网易云音乐：歌词 + 翻译一起用效果最好',
            body1: '这个歌词源读取网易云的逐字歌词（YRC），没有逐字时退回逐行歌词。它会按歌名、歌手、专辑和时长挑选网易云上的歌曲，时长相差超过 5 秒就判定为不同版本（现场版、剪辑版等），交给下一个歌词源，避免歌词越唱越不同步。',
            body2: '建议同时开启「AI 提供商 / 翻译」里的「NetEase Translation（网易云人工翻译）」并把两者都排在第一位：原文和译文来自网易云的同一首歌，每一行都能一一对应，不会出现译文空行或一句被拆成两半。',
            body3: '网易云找不到这首歌、没有歌词或版本对不上时，会自动交给下面的歌词源；没有人工翻译时，翻译会退回到 Bing / Google 等机器翻译。'
        },
        'zh-TW': {
            title: '網易雲音樂：歌詞 + 翻譯一起用效果最好',
            body1: '這個歌詞來源讀取網易雲的逐字歌詞（YRC），沒有逐字時退回逐行歌詞。它會依歌名、歌手、專輯和時長挑選網易雲上的歌曲，時長相差超過 5 秒就判定為不同版本，交給下一個歌詞來源。',
            body2: '建議同時開啟「AI 供應商 / 翻譯」裡的「NetEase Translation（網易雲人工翻譯）」並把兩者都排在第一位：原文和譯文來自網易雲的同一首歌，每一行都能一一對應。',
            body3: '網易雲找不到歌曲或版本對不上時，會自動交給下面的歌詞來源；沒有人工翻譯時，翻譯會退回到機器翻譯。'
        },
        en: {
            title: 'NetEase: use it for both lyrics and translation',
            body1: 'Loads NetEase syllable-synced lyrics (YRC), falling back to line-synced lyrics. The song is matched by title, artist, album and duration; a duration gap over 5 seconds is treated as another recording and handed to the next provider.',
            body2: 'For the best result, also enable "NetEase Translation" under AI providers and put both first: original lines and translations then come from the same NetEase song and line up one to one.',
            body3: 'If NetEase has no match, the next lyrics provider is used; without a human translation, machine translation (Bing / Google) takes over.'
        }
    };

    function createInfoBox(React, keys) {
        return React.createElement('div', { className: 'ai-addon-setting', style: { marginTop: '16px' } },
            React.createElement('div', { className: 'ai-addon-info-box' },
                React.createElement('p', { style: { fontWeight: 700, marginBottom: '8px' } }, getText('title')),
                ...keys.map(key => React.createElement('p', { key, style: { marginBottom: '8px' } }, getText(key)))
            )
        );
    }

    const NeteaseLyricsAddon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[NetEase Lyrics Addon] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            const React = Spicetify.React;
            return function NeteaseLyricsSettings() {
                return React.createElement('div', { className: 'ai-addon-settings netease-settings' },
                    createInfoBox(React, ['body1', 'body2', 'body3']));
            };
        },

        async getLyrics(info) {
            const durationMs = Number(info?.duration) || 0;
            const result = {
                uri: info?.uri || '',
                provider: ADDON_INFO.id,
                cacheVersion: CACHE_VERSION,
                karaoke: null,
                synced: null,
                unsynced: null,
                karaokeSource: null,
                copyright: null,
                error: null
            };
            if (!info?.title) {
                result.error = 'Missing track metadata';
                return result;
            }

            try {
                const match = await matchTrack({ ...info, durationMs });
                if (!match) {
                    result.error = 'No NetEase match';
                    return result;
                }
                const { song, lyric } = match;
                if (durationMs && Math.abs(durationMs - song.duration) > MAX_DURATION_DIFF_MS) {
                    result.error = `NetEase version differs by ${Math.round(Math.abs(durationMs - song.duration) / 1000)}s`;
                    return result;
                }
                if (lyric?.nolyric || lyric?.uncollected || PURE_MUSIC.test(lyric?.lrc?.lyric || '')) {
                    result.error = 'No lyrics';
                    return result;
                }

                const karaoke = parseYrc(lyric?.yrc?.lyric);
                const synced = parseLrc(lyric?.lrc?.lyric, durationMs);
                if (karaoke.length) {
                    result.karaoke = karaoke;
                    result.karaokeSource = 'netease-yrc';
                }
                if (synced.length) {
                    result.synced = synced;
                } else if (karaoke.length) {
                    result.synced = karaoke.map(({ startTime, endTime, text }) => ({ startTime, endTime, text }));
                }
                const lines = result.synced || [];
                result.unsynced = lines.length ? lines.map(({ text }) => ({ text })) : null;
                result.netease = { songId: song.id, name: song.name, album: song.album?.name || '' };

                if (!result.karaoke && !result.synced) result.error = 'No lyrics';
                return result;
            } catch (error) {
                result.error = error?.message || 'NetEase request failed';
                console.warn('[NetEase Lyrics Addon] Failed to load lyrics:', error);
                return result;
            }
        }
    };

    window.ivLyricsNetease = Object.freeze({ matchTrack, createInfoBox, getText });

    const ONE_TIME_SETUP_KEY = 'ivLyrics:netease-lyrics-default-applied';
    const BUILT_IN_PROVIDERS = ['spotify', 'lrclib', 'paxsenix', 'lyricsplus', 'unison'];

    // Enable once and move to the top; later changes in the provider settings are kept.
    // getProviderOrder() drops unregistered ids, so wait for the built-in providers
    // (loaded after this file) before saving the order.
    const applyDefaultSetup = (manager, attempt = 0) => {
        if (localStorage.getItem(ONE_TIME_SETUP_KEY) === '1') return;
        if (attempt < 100 && BUILT_IN_PROVIDERS.some(id => !manager.getAddon(id))) {
            setTimeout(() => applyDefaultSetup(manager, attempt + 1), 100);
            return;
        }
        try {
            manager.setProviderEnabled(ADDON_INFO.id, true);
            const order = manager.getProviderOrder().filter(id => id !== ADDON_INFO.id);
            manager.setProviderOrder([ADDON_INFO.id, ...order]);
            localStorage.setItem(ONE_TIME_SETUP_KEY, '1');
        } catch (error) {
            console.warn('[NetEase Lyrics] Failed to apply default provider order:', error);
        }
    };

    const registerAddon = () => {
        if (!window.LyricsAddonManager) {
            setTimeout(registerAddon, 100);
            return;
        }
        window.LyricsAddonManager.register(NeteaseLyricsAddon);
        applyDefaultSetup(window.LyricsAddonManager);
    };

    registerAddon();
})();
