import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Addon_Lyrics_Netease.js', import.meta.url), 'utf8');
const track = { uri: 'spotify:track:fixture', title: '嘉宾', artist: '张远', album: '嘉宾', duration: 333000 };
const song = (overrides = {}) => ({
    id: 1, name: '嘉宾', artists: [{ name: '张远' }], album: { name: '嘉宾' }, duration: 333000,
    ...overrides
});
const lyric = {
    lrc: { lyric: '[00:21.30]First line\n[00:25.47]Second line' },
    yrc: { lyric: '[21300,2000](21300,1000,0)First (22300,1000,0)line' }
};

function load(search) {
    let addon;
    const calls = [];
    const window = { LyricsAddonManager: { register(value) { addon = value; } } };
    const Spicetify = { CosmosAsync: { async get(url) {
        calls.push(url);
        if (url.includes('/search/')) {
            const params = new URL(url).searchParams;
            const query = params.get('s');
            return { result: { songs: typeof search === 'function' ? search(query, params) : search } };
        }
        return lyric;
    } } };
    vm.runInNewContext(source, {
        window, Spicetify, console,
        localStorage: { getItem: () => '1' },
        setTimeout() { throw new Error('unexpected timer'); }
    });
    return { addon, shared: window.ivLyricsNetease, calls };
}

// Metadata observed from NetEase's search for 嘉宾 张远: the Cantonese
// recording has almost exactly the same duration as Spotify's Mandarin one.
const cantonese = song({
    id: 1966783538, name: '嘉宾 (粤语版)', album: { name: '嘉宾 (粤语版)' }, duration: 333628
});
const accompaniment = song({
    id: 1966783539, name: '嘉宾 (粤语版伴奏)', album: { name: '嘉宾 (粤语版)' }, duration: 333628
});
const cover = song({
    id: 3406884978, name: '嘉宾 (Cover 张远 & 王泽言)', artists: [{ name: '林子锦' }], duration: 333738
});

test('嘉宾 Mandarin does not use the similarly timed Cantonese recording or a cover', async () => {
    const h = load([cantonese, accompaniment, cover]);
    const result = await h.addon.getLyrics(track);
    assert.equal(result.error, 'No NetEase match');
    assert.equal(result.karaoke, null);
    assert.equal(result.synced, null);
    assert.equal(h.calls.filter(url => url.includes('/search/')).length, 3);
    assert.equal(h.calls.some(url => url.includes('/lyric/')), false);
    assert.notEqual(result.cacheVersion, 'netease-1', 'discard old incorrect matches');
});

// Rankings observed from NetEase: with the album the Mandarin album recording is
// result 13; without it the first page holds only the Cantonese edition.
const withFiller = (entries, length) => {
    const songs = [];
    for (const [rank, entry] of entries) {
        while (songs.length < rank - 1) songs.push(song({ id: 100 + songs.length, name: 'Other song' }));
        songs.push(entry);
    }
    while (songs.length < length) songs.push(song({ id: 100 + songs.length, name: 'Other song' }));
    return songs;
};

test('the album query finds the original Mandarin release ranked below the Cantonese edition', async () => {
    const queries = [];
    const h = load((query, params) => {
        queries.push(query);
        const songs = query === '嘉宾 张远 嘉宾'
            ? withFiller([[1, cantonese], [5, accompaniment],
                [9, song({ id: 2117777168, album: { name: '' }, duration: 333628 })],
                [10, song({ id: 2084470770, album: { name: 'Guests' }, duration: 333670 })],
                [13, song({ id: 1809701604, duration: 333628 })]], 60)
            : withFiller([[1, cantonese], [2, accompaniment]], 60);
        return songs.slice(0, Number(params.get('limit')));
    });
    const result = await h.addon.getLyrics(track);
    assert.equal(result.error, null);
    assert.equal(result.netease.songId, 1809701604, 'the album match wins among valid recordings');
    assert.deepEqual(queries, ['嘉宾 张远 嘉宾']);
});

test('searches fall back from album to title and artist, then title alone', async () => {
    const queries = [];
    const h = load(query => {
        queries.push(query);
        return query === '嘉宾' ? [song({ id: 3 })] : [cantonese];
    });
    const result = await h.addon.getLyrics({ ...track, title: '嘉宾 (Remastered 2024)', album: '嘉宾 - 2024 Remaster' });
    assert.equal(result.netease.songId, 3);
    assert.deepEqual(queries, ['嘉宾 张远 嘉宾', '嘉宾 张远', '嘉宾']);

    const withoutAlbum = [];
    await load(query => { withoutAlbum.push(query); return [song()]; })
        .addon.getLyrics({ ...track, album: '' });
    assert.deepEqual(withoutAlbum, ['嘉宾 张远']);
});

test('an explicitly requested Cantonese edition still gets its native YRC and LRC', async () => {
    const h = load([cantonese]);
    const result = await h.addon.getLyrics({ ...track, title: '嘉宾（粤语版）' });
    assert.equal(result.error, null);
    assert.equal(result.netease.songId, cantonese.id);
    assert.equal(result.karaokeSource, 'netease-yrc');
    assert.equal(result.karaoke[0].syllables[1].startTime, 22300);
    assert.equal(result.synced[1].text, 'Second line');
});

test('a matching original wins even when a different edition has the preferred album', async () => {
    const h = load([cantonese, song({ album: { name: 'Other release' } })]);
    const result = await h.addon.getLyrics({ ...track, album: cantonese.album.name });
    assert.equal(result.error, null);
    assert.equal(result.netease.songId, 1);
});

test('exact title and artist cannot be replaced by album or duration bonuses', async () => {
    for (const candidate of [
        song({ name: 'Other song' }),
        song({ name: '嘉宾2.0' }),
        song({ artists: [{ name: 'Other artist' }] }),
        song({ artists: [{ name: '张远翻唱' }] }),
        song({ artists: [{ name: '' }] }),
        song({ artists: [] })
    ]) {
        const result = await load([candidate]).addon.getLyrics(track);
        assert.equal(result.error, 'No NetEase match', JSON.stringify(candidate));
    }
});

test('live, remix, instrumental and other language titles remain distinct', async () => {
    for (const name of [
        '嘉宾 (Live)', '嘉宾 (Live from Beijing)', '嘉宾 - Live from Beijing',
        '嘉宾 (Remix)', '嘉宾 (Acoustic Version)', '嘉宾 (English Version)',
        '嘉宾 (伴奏)', '嘉宾 (现场版)'
    ]) {
        const h = load([song({ name })]);
        assert.equal((await h.addon.getLyrics(track)).error, 'No NetEase match', name);
    }
});

test('search continues past a wrong-duration exact match to find a valid recording', async () => {
    const h = load(query => query.includes('张远')
        ? [song({ duration: 350000 })]
        : [song({ id: 2, album: { name: 'Reissue' } })]);
    const result = await h.addon.getLyrics(track);
    assert.equal(result.error, null);
    assert.equal(result.netease.songId, 2);
    assert.equal(h.calls.filter(url => url.includes('/search/')).length, 3);
});

test('duration filtering applies before scoring and also to the translation shared match', async () => {
    const h = load([song({ duration: 350000 }), song({ id: 2, duration: 337000, album: { name: 'Reissue' } })]);
    const match = await h.shared.matchTrack({ ...track, durationMs: track.duration });
    assert.equal(match.song.id, 2);
    for (const duration of [338001, undefined, 'invalid', 0]) {
        const invalid = load([song({ duration })]);
        assert.equal(await invalid.shared.matchTrack({ ...track, durationMs: track.duration }), null);
    }
});

test('punctuation, featured credits and remaster metadata still allow matching', async () => {
    for (const title of ['嘉宾 (feat. Guest)', '嘉宾 (Remastered 2024)', '嘉宾 - 2024 Remaster']) {
        const result = await load([song()]).addon.getLyrics({ ...track, title });
        assert.equal(result.error, null, title);
    }
});

test('exact local metadata without a known artist or duration can still match', async () => {
    const result = await load([song()]).addon.getLyrics({ title: '嘉宾', uri: 'spotify:local:fixture' });
    assert.equal(result.error, null);
    assert.equal(result.netease.songId, 1);
});
