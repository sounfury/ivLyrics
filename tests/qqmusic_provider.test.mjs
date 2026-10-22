import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const fixture=JSON.parse(read('tests/fixtures/qqmusic_qrc.json'));
const track={uri:'spotify:track:fixture',title:'Example',artist:'Artist',album:'Album',duration:6000};
const song=(overrides={})=>({id:1,mid:'mid1',title:'Example',singer:[{name:'Artist'}],album:{name:'Album'},interval:6,...overrides});
const xml=(original=fixture.original.hex,translation=fixture.translation.hex)=>`<!--<lyric><content><![CDATA[${original}]]></content><contentts><![CDATA[${translation}]]></contentts></lyric>-->`;

function load({mobile=[song()],desktop=[],transport,download=xml(),fallback={retcode:0},getError,proxyTemplate}={}) {
    const calls=[],addons={};
    const window={LyricsAddonManager:{register:addon=>{addons.lyrics=addon;}},AIAddonManager:{register:addon=>{addons.translation=addon;}}};
    if (proxyTemplate) window.localStorage={getItem:()=>proxyTemplate};
    const context=vm.createContext({window,console,Blob,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,AbortSignal,atob,setTimeout,clearTimeout,
        fetch:async(url,options)=>{
            assert.ok(proxyTemplate && url.startsWith('https://cors.example/'));
            assert.equal(options.credentials,'omit');
            assert.equal(options.headers,undefined,'no Spotify auth or cookies are forwarded');
            calls.push(url);
            return {ok:true,text:async()=>download};
        },
        Spicetify:{Player:{data:{item:{uri:track.uri,album:{name:track.album},duration:{milliseconds:track.duration}}}},CosmosAsync:{get:async url=>{
            calls.push(url);
            if (transport) return transport(url);
            if (url.includes('musicu.fcg')) {
                const payload=JSON.parse(new URL(url).searchParams.get('data'));
                const key=Object.keys(payload).find(key=>key!=='comm');
                const isMobile=key.includes('Mobile');
                if (getError?.(isMobile)) throw new Error('Mobile unavailable');
                const songs=typeof mobile==='function'?mobile(payload[key].param.query):mobile;
                return {code:0,[key]:{code:0,data:{body:isMobile?{item_song:songs}:{song:{list:desktop}}}}};
            }
            if (url.includes('lyric_download')) return download;
            if (url.includes('fcg_query_lyric')) return fallback;
            throw new Error('Unexpected transport URL');
        }}}});
    for(const file of ['HumanLyricsTranslation.js','QQMusicProtocol.js','QQMusicRuntime.js','Addon_Lyrics_QQMusic.js','Addon_AI_QQMusicTranslation.js']) vm.runInContext(read(file),context,{filename:file});
    return {window,addons,calls};
}
const toJSON=value=>JSON.parse(JSON.stringify(value));

test('QRC decrypt matches independently generated C# reference vectors including block padding',async()=>{
    const h=load();
    for(const vector of [fixture.original,fixture.translation]) assert.equal(await h.window.ivLyricsQQMusicCodec.decrypt(vector.hex),vector.plain);
    await assert.rejects(h.window.ivLyricsQQMusicCodec.decrypt('deadbeef'),/Invalid/);
    await assert.rejects(h.window.ivLyricsQQMusicCodec.decrypt('zzzzzzzzzzzzzzzz'),/Invalid/);
    const corrupt=fixture.original.hex.slice(0,-2)+'ff';
    await assert.rejects(h.window.ivLyricsQQMusicCodec.decrypt(corrupt));
});

test('raw QRC XML uses the configured Spicetify CORS proxy instead of its JSON-only wrapper',async()=>{
    const h=load({proxyTemplate:'https://cors.example/{url}'});
    assert.equal((await h.addons.lyrics.getLyrics(track)).karaokeSource,'qqmusic-qrc');
    assert.equal(h.calls.filter(url=>url.startsWith('https://cors.example/')).length,1);
});

test('traditional Chinese playback metadata is simplified with ivLyrics OpenCC before comparison',async()=>{
    const h=load({mobile:[song({title:'梦醒时分',album:{name:'单程车票'},singer:[{name:'伍佰 & China Blue'}]})]});
    h.window.Translator=class {async convertChinese(text){return text.replaceAll('夢','梦').replaceAll('時','时').replaceAll('單','单').replaceAll('車','车');}};
    const result=await h.addons.lyrics.getLyrics({...track,title:'夢醒時分',album:'單程車票',artist:'伍佰'});
    assert.equal(result.error,null);
    const payload=JSON.parse(new URL(h.calls[0]).searchParams.get('data'));
    assert.equal(payload['music.search.SearchCgiService.DoSearchForQQMusicMobile'].param.query,'梦醒时分 伍佰 单程车票');
});

test('lyrics and translation reuse a single QQ recording and preserve repeated lines with distinct translations',async()=>{
    const h=load();
    const result=await h.addons.lyrics.getLyrics(track);
    assert.equal(result.error,null);
    assert.equal(result.qqmusic.songId,1);
    assert.equal(result.karaokeSource,'qqmusic-qrc');
    assert.equal(result.karaoke[0].startTime,1025);
    assert.equal(result.karaoke[0].syllables[1].startTime,1525);
    assert.equal(result.synced[2].endTime,6025);
    const streamed=[];
    const trans=await h.addons.translation.translateLyrics({text:'Hello world\nHello world\n\nGoodbye',title:track.title,artist:track.artist,trackId:'fixture',lang:'zh-CN',onLine:(...args)=>streamed.push(args)});
    assert.deepEqual(toJSON(trans.translation),['你好世界','再次问候','','再见']);
    assert.equal(streamed.length,4);
    assert.equal(h.calls.filter(url=>url.includes('musicu')).length,1);
    assert.equal(h.calls.filter(url=>url.includes('lyric_download')).length,1);
});

test('search expands grouped versions and falls back from mobile to desktop',async()=>{
    const h=load({mobile:[],desktop:[song({id:2,mid:'other',title:'Unrelated',grp:[song()]})]});
    const result=await h.addons.lyrics.getLyrics(track);
    assert.equal(result.qqmusic.songId,1);
    assert.equal(h.calls.filter(url=>url.includes('musicu')).length,2);
    const payload=JSON.parse(new URL(h.calls[0]).searchParams.get('data'));
    const request=payload['music.search.SearchCgiService.DoSearchForQQMusicMobile'];
    assert.equal(request.param.query,'Example Artist Album');
    assert.equal(payload.comm.ct,'11');
    assert.equal(payload.comm.cv,undefined,'mobile protocol omits cv');
});

test('version, subtitle, artist, and duration mismatches never reach the lyric endpoint',async()=>{
    for(const candidate of [song({title:'Example (Live)'}),song({subtitle:'粤语版'}),song({title:'Different'}),song({singer:[{name:'Other Artist'}]}),song({interval:20}),song({interval:0})]){
        const h=load({mobile:[candidate]});
        const result=await h.addons.lyrics.getLyrics(track);
        assert.equal(result.error,'No confident QQ Music match',JSON.stringify(candidate));
        assert.equal(h.calls.some(url=>url.includes('lyric_download')),false);
    }
});

test('album-aware search falls back to title/artist and strips search highlights',async()=>{
    const queries=[];
    const h=load({mobile:query=>{queries.push(query);return query==='Example Artist Album'?[song({title:'Other'})]:[song({title:'<em>Example</em>',singer:[{name:'\u0001Artist\u0002'}]})];}});
    assert.equal((await h.addons.lyrics.getLyrics(track)).error,null);
    assert.deepEqual(queries,['Example Artist Album','Example Artist']);
});

test('LRC/base64 fallback and absent QRC still provide line timing and published Chinese translations',async()=>{
    const h=load({download:xml('',''),fallback:{retcode:0,lyric:Buffer.from('[00:01]Hello world\n[00:03]Goodbye').toString('base64'),trans:Buffer.from('[00:01]你好世界\n[00:03]再见').toString('base64')}});
    const lyrics=await h.addons.lyrics.getLyrics(track);
    assert.equal(lyrics.error,null);
    assert.equal(lyrics.karaoke,null);
    assert.equal(lyrics.synced.length,2);
    const trans=await h.addons.translation.translateLyrics({text:'Hello world\nGoodbye',lang:'zh',title:'Example',artist:'Artist',trackId:'fixture'});
    assert.deepEqual(toJSON(trans.translation),['你好世界','再见']);
});

test('missing translation, wrong language, pronunciation, and unrelated source text fail for the manager to try another provider',async()=>{
    const noTrans=load({download:xml(fixture.original.hex,'')});
    await assert.rejects(noTrans.addons.translation.translateLyrics({text:'Hello world',title:'Example',artist:'Artist',trackId:'fixture',lang:'zh'}),/no translation/);
    const h=load();const args={text:'Hello world',title:'Example',artist:'Artist',trackId:'fixture',lang:'zh'};
    await assert.rejects(h.addons.translation.translateLyrics({...args,lang:'en'}),/Chinese/);
    await assert.rejects(h.addons.translation.translateLyrics({...args,wantSmartPhonetic:true}),/pronunciation/);
    await assert.rejects(h.addons.translation.translateLyrics({...args,text:'Entirely unrelated words'}),/Only 0\/1/);
});

test('failed cached requests can be retried instead of permanently caching missing lyrics',async()=>{
    let missing=true;
    const h=load({mobile:()=>missing?[song({title:'Different'})]:[song()]});
    assert.equal((await h.addons.lyrics.getLyrics(track)).error,'No confident QQ Music match');
    missing=false;
    assert.equal((await h.addons.lyrics.getLyrics(track)).error,null);
});

test('translation alignment handles one-to-many, many-to-one, and unchanged NetEase translation contract',async()=>{
    const h=load();const align=h.window.ivLyricsHumanTranslation.alignTranslations;
    const split=align(['Hello','world'],[{key:'helloworld',translation:'你好 世界'}]);
    assert.deepEqual(toJSON(split.translation),['你好','世界']);
    const merged=align(['Hello world'],[{key:'hello',translation:'你好'},{key:'world',translation:'世界'}]);
    assert.deepEqual(toJSON(merged.translation),['你好 世界']);
    const netease=[];
    h.window.AIAddonManager.register=addon=>netease.push(addon);
    // Supply the same shared-match contract used by the existing NetEase plugin.
    h.window.ivLyricsNetease={matchTrack:async()=>({lyric:{lrc:{lyric:'[00:01]Hello world'},tlyric:{lyric:'[00:01]你好世界'}}})};
    // The VM was created with its own Spicetify; the existing playback metadata is sufficient.
    const ctx=vm.createContext({window:h.window,Spicetify:{Player:{data:{item:{uri:track.uri,album:{name:'Album'},duration:{milliseconds:6000}}}}},console,localStorage:{getItem:()=> '1'},setTimeout});
    vm.runInContext(read('Addon_AI_NeteaseTranslation.js'),ctx);
    const result=await netease[0].translateLyrics({text:'Hello world',title:'Example',artist:'Artist',trackId:'fixture',lang:'zh'});
    assert.deepEqual(toJSON(result.translation),['你好世界']);
});

test('manifest loads shared modules before both QQ plugins and the existing NetEase translation plugin',()=>{
    const list=JSON.parse(read('manifest.json')).subfiles_extension;
    for(const [dependency,consumer] of [['QQMusicProtocol.js','QQMusicRuntime.js'],['QQMusicRuntime.js','Addon_Lyrics_QQMusic.js'],['QQMusicRuntime.js','Addon_AI_QQMusicTranslation.js'],['HumanLyricsTranslation.js','Addon_AI_NeteaseTranslation.js'],['HumanLyricsTranslation.js','Addon_AI_QQMusicTranslation.js']]) assert.ok(list.indexOf(dependency)>=0&&list.indexOf(dependency)<list.indexOf(consumer));
});
