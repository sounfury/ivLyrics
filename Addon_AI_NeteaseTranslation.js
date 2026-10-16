/**
 * NetEase Translation Addon for ivLyrics
 * Translation-only provider that reuses NetEase Cloud Music's human-made
 * lyric translations (tlyric) instead of machine translation. It matches the
 * playing track on NetEase, then aligns each translated line with the lyrics
 * ivLyrics is showing.
 *
 * @author local
 * @version 1.3.0
 */

(() => {
    'use strict';

    const ADDON_INFO = {
        id: 'netease-translation',
        name: 'NetEase Translation (网易云人工翻译)',
        author: 'local',
        description: {
            ko: 'NetEase Cloud Music의 사람 번역 가사를 사용하는 중국어 번역 전용 제공자 (API 키 불필요)',
            en: 'Chinese translation-only provider using human-made lyric translations from NetEase Cloud Music (no API key required)',
            'zh-CN': '使用网易云音乐人工歌词翻译的中文纯翻译提供商（无需 API 密钥）',
            'zh-TW': '使用網易雲音樂人工歌詞翻譯的中文純翻譯供應商（不需要 API 金鑰）'
        },
        version: '1.3.0',
        supports: {
            translate: true,
            pronunciation: false,
            metadata: false,
            tmi: false,
            lyricsStudy: false,
            characterPronunciation: false,
            culturalAnnotations: false,
            wordSupplements: false
        }
    };

    const SEARCH_URL = 'https://music.163.com/api/search/get?limit=10&type=1&s=';
    const LYRIC_URL = 'https://music.163.com/api/song/lyric?lv=-1&tv=-1&id=';
    const REQUEST_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:93.0) Gecko/20100101 Firefox/93.0',
        Referer: 'https://music.163.com/'
    };
    // ivLyrics rejects empty lines for non-empty sources; a zero-width space
    // survives trim() and renders as nothing for lines NetEase did not translate.
    const BLANK_TRANSLATION = '\u200B';
    const MIN_MATCHED_RATIO = 0.4;
    const FUZZY_THRESHOLD = 0.7;
    const LYRICS_CACHE_LIMIT = 20;
    const lyricsCache = new Map();

    async function requestJson(url) {
        if (typeof Spicetify !== 'undefined' && Spicetify.CosmosAsync) {
            try {
                const result = await Spicetify.CosmosAsync.get(url, null, REQUEST_HEADERS);
                return typeof result === 'string' ? JSON.parse(result) : result;
            } catch (error) {
                window.__ivLyricsDebugLog?.('[NetEase Translation] CosmosAsync failed, retrying with fetch:', error?.message);
            }
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`[NetEase Translation] HTTP ${response.status}`);
        }
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

    function getPlayingTrack(trackId) {
        const item = Spicetify?.Player?.data?.item;
        if (!item) return null;
        if (trackId && !String(item.uri || '').endsWith(trackId)) return null;
        return {
            durationMs: item.duration?.milliseconds ?? Number(item.metadata?.duration) ?? null,
            album: item.album?.name ?? item.metadata?.album_title ?? ''
        };
    }

    function pickSong(songs, title, artist, track) {
        const wantedTitle = normalizeText(cleanTitle(title));
        const wantedArtists = String(artist ?? '').split(/[,&、]|\s+feat\.?\s+/i).map(normalizeText).filter(Boolean);
        const wantedAlbum = normalizeText(track?.album);

        let best = null;
        let bestScore = 0;
        for (const song of songs) {
            let score = 0;
            const name = normalizeText(cleanTitle(song.name));
            if (name === wantedTitle) score += 4;
            else if (name.includes(wantedTitle) || wantedTitle.includes(name)) score += 2;

            const songArtists = (song.artists || []).map(a => normalizeText(a.name));
            if (wantedArtists.some(a => songArtists.some(s => s === a || s.includes(a) || a.includes(s)))) score += 3;
            if (wantedAlbum && normalizeText(song.album?.name) === wantedAlbum) score += 2;

            if (track?.durationMs) {
                const diff = Math.abs(track.durationMs - song.duration);
                if (diff < 3000) score += 3;
                else if (diff > 15000) score -= 3;
            }

            if (score > bestScore) {
                best = song;
                bestScore = score;
            }
        }
        // Require at least a title or artist match on top of any duration bonus.
        return bestScore >= 5 ? best : null;
    }

    function parseLrc(lrc) {
        const lines = [];
        for (const raw of String(lrc ?? '').split('\n')) {
            const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
            if (stamps.length === 0) continue;
            const text = raw.replace(/\[[^\]]*\]/g, '').trim();
            for (const stamp of stamps) {
                lines.push({ time: Math.round((Number(stamp[1]) * 60 + Number(stamp[2])) * 1000), text });
            }
        }
        return lines.sort((a, b) => a.time - b.time);
    }

    function buildTranslatedLines(lyric) {
        const original = parseLrc(lyric?.lrc?.lyric);
        const translated = parseLrc(lyric?.tlyric?.lyric).filter(line => line.text);
        if (original.length === 0 || translated.length === 0) return [];

        const result = [];
        let cursor = 0;
        for (const line of original) {
            if (!line.text) continue;
            while (cursor < translated.length - 1
                && Math.abs(translated[cursor + 1].time - line.time) <= Math.abs(translated[cursor].time - line.time)) {
                cursor++;
            }
            const candidate = translated[cursor];
            if (Math.abs(candidate.time - line.time) <= 300) {
                result.push({ key: normalizeText(line.text), translation: candidate.text.replace(/^[「“"]|[」”"]$/g, '') });
            }
        }
        return result.filter(line => line.key);
    }

    function bigrams(text) {
        const grams = [];
        for (let index = 0; index < text.length - 1; index++) grams.push(text.slice(index, index + 2));
        return grams;
    }

    function similarity(a, b) {
        if (a === b) return 1;
        if (a.length < 2 || b.length < 2) return 0;
        const gramsA = bigrams(a);
        const counts = new Map();
        for (const gram of bigrams(b)) counts.set(gram, (counts.get(gram) || 0) + 1);
        let common = 0;
        for (const gram of gramsA) {
            const count = counts.get(gram);
            if (count) {
                common++;
                counts.set(gram, count - 1);
            }
        }
        return (2 * common) / (gramsA.length + b.length - 1);
    }

    function findMatch(key, entries, cursor) {
        // Prefer the next lines in order so repeated choruses keep their own translation.
        for (let index = cursor; index < Math.min(entries.length, cursor + 8); index++) {
            if (entries[index].key === key) return index;
        }
        let exact = entries.findIndex(entry => entry.key === key);
        if (exact >= 0) return exact;

        let best = -1;
        let bestScore = FUZZY_THRESHOLD;
        for (let index = 0; index < entries.length; index++) {
            const score = similarity(key, entries[index].key);
            if (score > bestScore || (score === bestScore && best >= 0 && index >= cursor && best < cursor)) {
                best = index;
                bestScore = score;
            }
        }
        return best;
    }

    function findExact(key, entries, cursor) {
        for (let index = cursor; index < Math.min(entries.length, cursor + 8); index++) {
            if (entries[index].key === key) return index;
        }
        return entries.findIndex(entry => entry.key === key);
    }

    // A NetEase line that the displayed lyrics split into several shorter lines.
    function findContaining(key, entries, cursor) {
        if (key.length < 2) return -1;
        const start = Math.max(0, cursor - 1);
        for (let index = start; index < Math.min(entries.length, cursor + 8); index++) {
            if (entries[index].key.length > key.length && entries[index].key.includes(key)) return index;
        }
        if (key.length < 4) return -1;
        return entries.findIndex(entry => entry.key.length > key.length && entry.key.includes(key));
    }

    // Several NetEase lines that the displayed lyrics merged into one line.
    function findMerged(key, entries, cursor) {
        const starts = [];
        for (let index = cursor; index < Math.min(entries.length, cursor + 8); index++) starts.push(index);
        for (let index = 0; index < entries.length; index++) if (index < cursor || index >= cursor + 8) starts.push(index);

        for (const start of starts) {
            if (!entries[start].key || !key.startsWith(entries[start].key) || entries[start].key === key) continue;
            let offset = entries[start].key.length;
            let end = start;
            while (offset < key.length && end + 1 < entries.length && entries[end + 1].key
                && key.startsWith(entries[end + 1].key, offset)) {
                end++;
                offset += entries[end].key.length;
            }
            if (end > start && offset === key.length) return { start, end };
        }
        return null;
    }

    const PHRASE_BREAK = /[\s,，、。;；!！?？]/;

    // Splits one NetEase translation over the fragments the displayed lyrics cut
    // the line into, in proportion to each fragment's length, preferring to cut
    // at NetEase's own spaces and punctuation.
    function splitAcrossLines(translation, weights) {
        const count = weights.length;
        const phrases = translation.split(/[\s,，、。;；!！?？]+/).filter(Boolean);
        if (phrases.length === count) return phrases;

        const chars = Array.from(translation.trim());
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        if (chars.length < count || total <= 0) {
            return [translation, ...Array(count - 1).fill(BLANK_TRANSLATION)];
        }

        const parts = [];
        let start = 0;
        let cumulative = 0;
        for (let index = 0; index < count - 1; index++) {
            cumulative += weights[index];
            const remaining = count - 1 - index;
            const target = Math.round(chars.length * cumulative / total);
            let cut = Math.min(Math.max(target, start + 1), chars.length - remaining);
            for (let delta = 0; delta <= 3; delta++) {
                const candidates = [target + delta, target - delta];
                const found = candidates.find(position => position > start && position <= chars.length - remaining
                    && PHRASE_BREAK.test(chars[position - 1] + chars[position]));
                if (found !== undefined) {
                    cut = found;
                    break;
                }
            }
            parts.push(chars.slice(start, cut).join(''));
            start = cut;
        }
        parts.push(chars.slice(start).join(''));
        return parts.map(part => part.replace(/^[\s,，、。;；]+|[\s,，、;；]+$/g, '') || BLANK_TRANSLATION);
    }

    function alignTranslations(sourceLines, entries) {
        const keys = sourceLines.map(normalizeText);
        const translation = new Array(sourceLines.length).fill(BLANK_TRANSLATION);
        let cursor = 0;
        let sourceCount = 0;
        let matchedCount = 0;

        for (let index = 0; index < sourceLines.length; index++) {
            const key = keys[index];
            if (!sourceLines[index].trim()) {
                translation[index] = '';
                continue;
            }
            if (!key) continue;
            sourceCount++;

            const exact = findExact(key, entries, cursor);
            if (exact >= 0) {
                translation[index] = entries[exact].translation;
                matchedCount++;
                cursor = exact + 1;
                continue;
            }

            const containing = findContaining(key, entries, cursor);
            if (containing >= 0) {
                const entryKey = entries[containing].key;
                const group = [index];
                let offset = entryKey.indexOf(key) + key.length;
                for (let next = index + 1; next < sourceLines.length && offset < entryKey.length; next++) {
                    if (!sourceLines[next].trim()) continue;
                    const position = keys[next] ? entryKey.indexOf(keys[next], offset) : -1;
                    if (position < 0 || position - offset > 2) break;
                    group.push(next);
                    offset = position + keys[next].length;
                }
                const parts = splitAcrossLines(entries[containing].translation, group.map(lineIndex => keys[lineIndex].length));
                group.forEach((lineIndex, partIndex) => {
                    translation[lineIndex] = parts[partIndex];
                });
                sourceCount += group.length - 1;
                matchedCount += group.length;
                cursor = containing + 1;
                index = group[group.length - 1];
                continue;
            }

            const merged = findMerged(key, entries, cursor);
            if (merged) {
                translation[index] = entries.slice(merged.start, merged.end + 1).map(entry => entry.translation).join(' ');
                matchedCount++;
                cursor = merged.end + 1;
                continue;
            }

            const fuzzy = findMatch(key, entries, cursor);
            if (fuzzy >= 0) {
                translation[index] = entries[fuzzy].translation;
                matchedCount++;
                cursor = fuzzy + 1;
            }
        }

        return { translation, sourceCount, matchedCount };
    }

    async function getNeteaseTranslation({ trackId, title, artist }) {
        const cacheKey = trackId || `${title}::${artist}`;
        if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

        const promise = (async () => {
            const track = getPlayingTrack(trackId);
            // Reuse the NetEase lyrics provider's match so original lines and
            // translations come from the same NetEase song.
            const shared = window.ivLyricsNetease && trackId
                ? await window.ivLyricsNetease.matchTrack({
                    uri: `spotify:track:${trackId}`, title, artist,
                    album: track?.album, durationMs: track?.durationMs
                }).catch(() => null)
                : null;
            if (shared) {
                const lines = buildTranslatedLines(shared.lyric);
                if (lines.length === 0) throw new Error('[NetEase Translation] NetEase has no translation for this track');
                return lines;
            }
            const search = await requestJson(SEARCH_URL + encodeURIComponent(`${cleanTitle(title)} ${artist ?? ''}`.trim()));
            const songs = search?.result?.songs;
            if (!songs?.length) throw new Error('[NetEase Translation] Track not found on NetEase');

            const song = pickSong(songs, title, artist, track);
            if (!song) throw new Error('[NetEase Translation] No confident NetEase match');

            const lyric = await requestJson(LYRIC_URL + song.id);
            const lines = buildTranslatedLines(lyric);
            if (lines.length === 0) throw new Error('[NetEase Translation] NetEase has no translation for this track');
            window.__ivLyricsDebugLog?.(`[NetEase Translation] Matched "${song.name}" (${song.id}), ${lines.length} translated lines`);
            return lines;
        })();

        lyricsCache.set(cacheKey, promise);
        if (lyricsCache.size > LYRICS_CACHE_LIMIT) lyricsCache.delete(lyricsCache.keys().next().value);
        promise.catch(() => lyricsCache.delete(cacheKey));
        return promise;
    }

    const addon = {
        ...ADDON_INFO,

        async init() {
            window.__ivLyricsDebugLog?.(`[NetEase Translation Addon] Initialized (v${ADDON_INFO.version})`);
        },

        getSettingsUI() {
            const React = Spicetify.React;
            return function NeteaseTranslationSettings() {
                const netease = window.ivLyricsNetease;
                if (!netease) return null;
                return React.createElement('div', { className: 'ai-addon-settings netease-settings' },
                    netease.createInfoBox(React, ['body2', 'body3']));
            };
        },

        async testConnection() {
            const result = await requestJson(SEARCH_URL + encodeURIComponent('Shape of You Ed Sheeran'));
            if (!result?.result?.songs?.length) {
                throw new Error('[NetEase Translation] Connection test returned no songs');
            }
            return true;
        },

        async translateLyrics({ text, lang, wantSmartPhonetic, onLine, trackId, title, artist }) {
            if (wantSmartPhonetic) {
                throw new Error('[NetEase Translation] Pronunciation generation is not supported');
            }
            if (!/^zh/i.test(String(lang ?? ''))) {
                throw new Error('[NetEase Translation] Only Chinese translation is available');
            }
            if (!text?.trim() || !title) {
                throw new Error('[NetEase Translation] Lyrics text and track title are required');
            }

            const entries = await getNeteaseTranslation({ trackId, title, artist });
            const sourceLines = text.replace(/\r\n?/g, '\n').split('\n');
            const { translation, sourceCount, matchedCount } = alignTranslations(sourceLines, entries);

            if (sourceCount === 0 || matchedCount / sourceCount < MIN_MATCHED_RATIO) {
                throw new Error(`[NetEase Translation] Only ${matchedCount}/${sourceCount} lines matched NetEase lyrics`);
            }

            if (typeof onLine === 'function') {
                translation.forEach((line, index) => onLine(index, line));
            }
            return { translation };
        }
    };

    const ONE_TIME_SETUP_KEY = 'ivLyrics:netease-translation-default-applied';

    const registerAddon = () => {
        if (!window.AIAddonManager) {
            setTimeout(registerAddon, 100);
            return;
        }
        window.AIAddonManager.register(addon);

        // Enable once and move to the top so NetEase is tried before machine translation;
        // later changes in the AI provider settings are kept.
        try {
            if (localStorage.getItem(ONE_TIME_SETUP_KEY) !== '1') {
                const manager = window.AIAddonManager;
                manager.setProviderEnabled(ADDON_INFO.id, true);
                const order = manager.getProviderOrder().filter(id => id !== ADDON_INFO.id);
                manager.setProviderOrder([ADDON_INFO.id, ...order]);
                localStorage.setItem(ONE_TIME_SETUP_KEY, '1');
            }
        } catch (error) {
            console.warn('[NetEase Translation] Failed to apply default provider order:', error);
        }
    };

    registerAddon();
})();
