/**
 * QQ Music search/lyrics protocol adapter for ivLyrics.
 * Request flow informed by Lyricify-Lyrics-Helper's QQMusic searcher/API.
 * Independent JavaScript implementation; see docs/qqmusic-source.md.
 */
(() => {
    'use strict';
    const SEARCH_URL = 'https://u6.y.qq.com/cgi-bin/musicu.fcg';
    const SEARCH_MODULE = 'music.search.SearchCgiService';
    const MOBILE_KEY = `${SEARCH_MODULE}.DoSearchForQQMusicMobile`;
    const HEADERS = { Referer: 'https://c.y.qq.com/', 'User-Agent': 'QQMusic 20080508(android)' };
    const cache = new Map();
    const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase()
        .replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{N}]+/gu, '');
    const cleanTitle = title => String(title ?? '')
        .replace(/\s*[([（【](?:(?:feat\.?|ft\.?|with|from|bonus)\b|(?:\d{4}\s+)?remaster(?:ed)?\b)[^)\]）】]*[)\]）】]/gi, '')
        .replace(/\s+-\s+(?:(?:\d{4}\s+)?remaster(?:ed)?\b|from\b).*$/i, '').trim();
    const unhighlight = text => String(text ?? '').replace(/<\/?em>/gi, '').replace(/[\u0001\u0002]/g, '');
    const CREDITS = /^\s*(作词|作曲|编曲|词|曲|制作人?|制作公司|营销推广|监制|混音|母带|和声|录音|录音室\/录音师|配唱制作人|吉他|贝斯|鼓|弦乐|出品|发行|企划|统筹|op|sp|lyricist|lyrics|composer|composed|music|arranger|producer|produced|mix(ed)?|master(ed|ing)?)\s*(by)?\s*[:：]/i;
    let chineseTranslator;
    async function simplify(text) {
        // Reuse ivLyrics' OpenCC support for Spotify's traditional Chinese
        // metadata. Conversion failure leaves strict matching in place.
        if (!/[\p{Script=Han}]/u.test(text) || typeof window.Translator !== 'function') return text;
        try {
            chineseTranslator ||= new window.Translator('zh', true);
            return await chineseTranslator.convertChinese(text, 't', 'cn');
        } catch { return text; }
    }


    async function request(url, json = false) {
        // Spicetify's external Cosmos get wrapper always calls response.json(),
        // which rejects QQ's XML. Read raw text through the same configured CORS
        // proxy directly; never send Spotify auth or browser cookies to it.
        const hasCosmos = typeof Spicetify !== 'undefined' && Spicetify.CosmosAsync;
        const proxyTemplate = hasCosmos && window.localStorage
            ? (window.localStorage.getItem('spicetify:corsProxyTemplate') || 'https://cors-proxy.spicetify.app/{url}')
            : '';
        let response;
        if (hasCosmos && (json || !proxyTemplate)) {
            let timer;
            try {
                response = await Promise.race([
                    Spicetify.CosmosAsync.get(url, null, HEADERS),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('QQ Music request timed out')), 12000); })
                ]);
                if (response != null) return json && typeof response === 'string' ? JSON.parse(response) : response;
            } catch (error) {
                window.__ivLyricsDebugLog?.('[QQ Music] Cosmos request failed:', error.message);
            } finally { clearTimeout(timer); }
        }
        const fetchUrl = proxyTemplate ? proxyTemplate.replace('{url}', url) : url;
        const result = await fetch(fetchUrl, { signal: AbortSignal.timeout(12000), credentials: 'omit' });
        if (!result.ok) throw new Error(`QQ Music HTTP ${result.status}`);
        return json ? result.json() : result.text();
    }

    function searchPayload(query, mobile) {
        return mobile ? {
            comm: { ct: '11', v: '20080508', tmeLoginType: '0', tmeLoginMethod: '0' },
            [MOBILE_KEY]: { module: SEARCH_MODULE, method: 'DoSearchForQQMusicMobile', param: {
                query, highlight: 1, searchid: '', sub_searchid: 0, search_type: 0, nqc_flag: 0,
                sin: 0, ein: 30, page_num: 1, num_per_page: 30, cat: 2, grp: 1,
                remoteplace: '', from: '', multi_zhida: 1, sem: 0, related_data: '', ambi_data: ''
            } }
        } : { req_1: { module: SEARCH_MODULE, method: 'DoSearchForQQMusicDesktop',
            param: { query, num_per_page: 30, page_num: 1, search_type: 0 } } };
    }

    async function search(query) {
        let failure;
        for (const mobile of [true, false]) {
            try {
                const payload = searchPayload(query, mobile);
                const response = await request(`${SEARCH_URL}?data=${encodeURIComponent(JSON.stringify(payload))}`, true);
                const result = response?.[mobile ? MOBILE_KEY : 'req_1'];
                if (Number(response?.code) !== 0 || Number(result?.code) !== 0
                    || (result?.data?.code != null && Number(result.data.code) !== 0)) throw new Error('QQ Music search rejected');
                const body = result?.data?.body;
                const songs = mobile ? body?.item_song : body?.song?.list;
                if (!Array.isArray(songs) || !songs.length) continue;
                const expanded = [], seen = new Set();
                const visit = (entries, depth = 0) => {
                    if (depth > 4) return;
                    for (const entry of entries) {
                        if (/^\d+$/.test(String(entry?.id)) && /^[a-z0-9]+$/i.test(entry?.mid || '') && !seen.has(String(entry.id))) {
                            seen.add(String(entry.id)); expanded.push(entry);
                        }
                        if (Array.isArray(entry?.grp)) visit(entry.grp, depth + 1);
                    }
                };
                visit(songs);
                if (expanded.length) return expanded;
            } catch (error) { failure = error; }
        }
        if (failure) throw failure;
        return [];
    }

    function scoreSong(song, info) {
        if (!normalize(cleanTitle(info.title)) || normalize(cleanTitle(unhighlight(song.title || song.name))) !== normalize(cleanTitle(info.title))) return -Infinity;
        // QQ can put the recording edition in subtitle instead of title.
        const edition = unhighlight(song.subtitle).match(/粤语|粵語|cantonese|国语|國語|mandarin|现场|現場|\blive\b|伴奏|instrumental|remix|acoustic|日语|日語|japanese|英语|英語|\benglish\b/i)?.[0];
        if (edition && !normalize(info.title).includes(normalize(edition))) return -Infinity;
        const artists = String(info.artist ?? '').split(/[,&、]|\s+feat\.?\s+/i).map(normalize).filter(Boolean);
        const found = (song.singer || []).flatMap(a => unhighlight(a.name).split(/[,&、]|\s+feat\.?\s+/i)).map(normalize).filter(Boolean);
        if (artists.length && !artists.some(artist => found.includes(artist))) return -Infinity;
        const duration = Number(info.durationMs ?? info.duration);
        const candidateDuration = Number(song.interval) * 1000;
        if (duration > 0 && (!Number.isFinite(candidateDuration) || candidateDuration <= 0 || Math.abs(candidateDuration - duration) > 5000)) return -Infinity;
        let score = 10;
        if (info.album && normalize(info.album) === normalize(unhighlight(song.album?.name))) score += 3;
        if (duration > 0) score += Math.max(0, 2 - Math.abs(candidateDuration - duration) / 2500);
        if (artists.length === found.length && artists.every(artist => found.includes(artist))) score += 1;
        return score;
    }

    async function searchSong(info) {
        const input = await simplify([info.title || '', info.artist || '', info.album || ''].map(s => String(s).replace(/\n/g,' ')).join('\n'));
        const [titleInput, artistInput, albumInput] = input.split('\n');
        const comparableInfo = {...info,title:titleInput,artist:artistInput,album:albumInput};
        const title = cleanTitle(titleInput), artist = String(artistInput ?? '').trim(), album = cleanTitle(albumInput);
        const queries = [album ? `${title} ${artist} ${album}` : '', `${title} ${artist}`, title]
            .map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
        for (const query of new Set(queries)) {
            const songs = await search(query);
            let best = null, highest = -Infinity;
            for (const song of songs) {
                const fields = [unhighlight(song.title || song.name), unhighlight(song.subtitle), unhighlight(song.album?.name), ...(song.singer || []).map(s => unhighlight(s.name))];
                const converted = (await simplify(fields.map(s => s.replace(/\n/g,' ')).join('\n'))).split('\n');
                const comparableSong = {...song,title:converted[0],subtitle:converted[1],album:{name:converted[2]},singer:converted.slice(3).map(name => ({name}))};
                const score = scoreSong(comparableSong, comparableInfo);
                if (score > highest) { best = song; highest = score; }
            }
            if (best) return best;
        }
        return null;
    }

    function decodeXml(text) {
        return String(text ?? '').replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code) => {
            const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code);
            return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
        }).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }
    function tag(xml, name) {
        const match = String(xml).match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
        if (!match) return '';
        const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
        return cdata ? cdata[1].trim() : decodeXml(match[1]).trim();
    }
    function unwrap(text) {
        const attribute = text.match(/\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/i);
        return attribute ? decodeXml(attribute[2]) : text.replace(/^\uFEFF/, '');
    }
    async function decodeChannel(value) {
        if (!value) return '';
        if (/^[\da-f\s]+$/i.test(value) && value.replace(/\s/g, '').length % 16 === 0) {
            return unwrap(await window.ivLyricsQQMusicCodec.decrypt(value));
        }
        if (/^\s*(<\?xml|<QrcInfos|\[)/i.test(value)) return unwrap(value);
        throw new Error('Unsupported QQ Music lyric encoding');
    }

    function parseLyrics(raw, duration = 0) {
        const karaoke = [], synced = [];
        const offset = Number(String(raw).match(/\[offset:([+-]?\d+)\]/i)?.[1]) || 0;
        for (const line of String(raw || '').split(/\r?\n/)) {
            const header = line.match(/^\[(\d+),(\d+)\]/);
            if (header) {
                const syllables = [];
                for (const part of line.slice(header[0].length).matchAll(/(.*?)\((\d+),(\d+)\)/g)) {
                    if (!part[1]) continue;
                    const startTime = Math.max(0, Number(part[2]) + offset);
                    syllables.push({text:part[1], startTime, endTime:Math.max(startTime + 1, Number(part[2]) + Number(part[3]) + offset)});
                }
                const text = syllables.map(s => s.text).join('').trim();
                if (!text) continue;
                const startTime = Math.max(0, Number(header[1]) + offset);
                const endTime = Math.max(startTime + 1, Number(header[1]) + Number(header[2]) + offset, ...syllables.map(s => s.endTime));
                karaoke.push({text, startTime, endTime, syllables});
                synced.push({text,startTime,endTime});
            } else {
                const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
                const text = line.replace(/\[[^\]]*\]/g, '').trim();
                if (text) for (const stamp of stamps) synced.push({text,startTime:Math.max(0,Math.round((Number(stamp[1])*60+Number(stamp[2]))*1000)+offset)});
            }
        }
        synced.sort((a,b) => a.startTime - b.startTime);
        karaoke.sort((a,b) => a.startTime - b.startTime);
        synced.forEach((line,i) => { if (line.endTime == null) line.endTime = Math.max(line.startTime+1, synced[i+1]?.startTime || Number(duration) || line.startTime+5000); });
        return {karaoke,synced};
    }
    function fromBase64(value) {
        return new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(atob(value || ''), c => c.charCodeAt(0)));
    }
    async function loadLyrics(song) {
        let raw = '', translation = '', qrcFailure;
        try {
            const response = await request(`https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg?version=15&miniversion=82&lrctype=4&musicid=${song.id}`);
            raw = await decodeChannel(tag(response, 'content'));
            try { translation = await decodeChannel(tag(response, 'contentts')); }
            catch (error) { window.__ivLyricsDebugLog?.('[QQ Music] Translation decode failed:', error.message); }
        } catch (error) { qrcFailure = error; }
        // The line-synced endpoint supplies a useful fallback when QRC is absent
        // or unavailable, as well as translations missing from lyric_download.
        if (!raw || !translation) {
            try {
                const result = await request(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${song.mid}&format=json&nobase64=0&g_tk=5381&platform=yqq&needNewCode=0`, true);
                if (Number(result?.retcode ?? result?.code) === 0) {
                    if (!raw && result.lyric) raw = fromBase64(result.lyric);
                    if (!translation && result.trans) translation = fromBase64(result.trans);
                }
            } catch (error) { if (!raw) throw qrcFailure || error; }
        }
        if (!raw) throw qrcFailure || new Error('QQ Music has no lyrics for this recording');
        const parsed = parseLyrics(raw, Number(song.interval)*1000);
        const translated = parseLyrics(translation).synced;
        const keep = line => !CREDITS.test(line.text)
            && !(line.startTime < 15000 && line.text.includes(' - ') && normalize(line.text.split(' - ')[0]) === normalize(unhighlight(song.title || song.name)))
            && !/^\s*纯音乐[，,]?\s*请欣赏\s*$/.test(line.text);
        const entries = [];
        for (const line of parsed.synced) {
            if (!keep(line)) continue;
            // Same platform timestamps: use a tight tolerance, never line indexes.
            let best = null, gap = 301;
            for (const candidate of translated) {
                const diff = Math.abs(candidate.startTime - line.startTime);
                if (diff < gap) { best = candidate; gap = diff; }
            }
            if (best?.text && normalize(best.text) && normalize(best.text) !== normalize(line.text)) entries.push({key:normalize(line.text), translation:best.text});
        }
        return {raw, translation, entries, karaoke:parsed.karaoke.filter(keep), synced:parsed.synced.filter(keep)};
    }

    function matchTrack(info) {
        const key = JSON.stringify([info.uri || '', info.title || '', info.artist || '', info.album || '', Number(info.durationMs ?? info.duration) || 0]);
        if (cache.has(key)) return cache.get(key);
        const promise = (async () => {
            const song = await searchSong(info);
            if (!song) return null;
            return {song, ...await loadLyrics(song)};
        })();
        cache.set(key,promise);
        if (cache.size > 30) cache.delete(cache.keys().next().value);
        const discard = () => { if (cache.get(key) === promise) cache.delete(key); };
        promise.then(result => { if (!result) discard(); }, discard);
        return promise;
    }

    function playingTrack(trackId, title, artist) {
        const item = typeof Spicetify !== 'undefined' ? Spicetify.Player?.data?.item : null;
        const uri = item?.uri || '';
        const matches = trackId && (uri === `spotify:track:${trackId}` || uri === trackId || `local-uri:${uri}` === trackId);
        return {
            uri: matches ? uri : (trackId ? `spotify:track:${trackId}` : ''), title, artist,
            album: matches ? item.album?.name || item.metadata?.album_title || '' : '',
            durationMs: matches ? Number(item.duration?.milliseconds ?? item.metadata?.duration) || 0 : 0
        };
    }
    window.ivLyricsQQMusic = Object.freeze({matchTrack,playingTrack,search,parseLyrics,simplify});
})();
