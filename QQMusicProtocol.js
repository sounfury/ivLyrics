/** QQ Music's QRC wire codec. Independently implemented as bit permutations.
 * Protocol reference: WXRIW/Lyricify-Lyrics-Helper (Decrypter/Qrc).
 * This is QQ's modified DES, NOT standard 3DES: little-endian words,
 * a shifted second-half key permutation and two changed substitution entries.
 * Uses the browser's zlib decoder; no remote code or .NET runtime required.
 */
(() => {
    'use strict';
    const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
    const FP = Array.from({length:64}, (_, i) => IP.indexOf(i + 1) + 1);
    const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
    const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
    const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
    const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
    const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
    const S = [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]];
    const permute = (bits, table) => table.map(position => bits[position - 1] || 0);
    const bitsFrom = bytes => Array.from({length:64}, (_, i) => (bytes[(i >> 5) * 4 + 3 - ((i & 31) >> 3)] >> (7 - (i & 7))) & 1);
    const bytesFrom = bits => {
        const out = new Uint8Array(8);
        bits.forEach((bit, i) => { out[(i >> 5) * 4 + 3 - ((i & 31) >> 3)] |= bit << (7 - (i & 7)); });
        return out;
    };
    function keysFor(bytes, reverse) {
        const key = permute(bitsFrom(bytes), PC1);
        let left = key.slice(0,28), right = key.slice(28);
        const rounds = SHIFTS.map(shift => {
            left = left.slice(shift).concat(left.slice(0,shift));
            right = right.slice(shift).concat(right.slice(0,shift));
            const both = left.concat(right);
            return PC2.map((position, i) => both[position - 1 + (i >= 24 ? 1 : 0)] || 0);
        });
        return reverse ? rounds.reverse() : rounds;
    }
    const keyBytes = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');
    const schedules = [keysFor(keyBytes.slice(16,24), true), keysFor(keyBytes.slice(8,16), false), keysFor(keyBytes.slice(0,8), true)];
    function block(bytes, keys) {
        const initial = permute(bitsFrom(bytes), IP);
        let left = initial.slice(0,32), right = initial.slice(32);
        for (const key of keys) {
            const expanded = permute(right, E).map((bit,i) => bit ^ key[i]);
            const substituted = [];
            for (let box = 0; box < 8; box++) {
                const b = expanded.slice(box * 6, box * 6 + 6);
                const row = b[0] * 2 + b[5], col = b[1] * 8 + b[2] * 4 + b[3] * 2 + b[4];
                const value = S[box][row * 16 + col];
                for (let i = 3; i >= 0; i--) substituted.push((value >> i) & 1);
            }
            const f = permute(substituted, P);
            [left, right] = [right, left.map((bit,i) => bit ^ f[i])];
        }
        return bytesFrom(permute(right.concat(left), FP));
    }
    function decryptBytes(hex) {
        hex = String(hex || '').replace(/\s/g, '');
        if (!hex || hex.length > 512 * 1024 || hex.length % 16 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('Invalid QQ Music QRC payload');
        const out = new Uint8Array(hex.length / 2);
        for (let offset = 0; offset < out.length; offset += 8) {
            let bytes = Uint8Array.from({length:8}, (_, i) => parseInt(hex.slice((offset + i) * 2, (offset + i) * 2 + 2), 16));
            for (const keys of schedules) bytes = block(bytes, keys);
            out.set(bytes, offset);
        }
        return out;
    }
    async function inflate(bytes) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        const reader = stream.getReader();
        const chunks = []; let size = 0;
        try {
            while (true) {
                const {value, done} = await reader.read();
                if (done) break;
                size += value.length;
                if (size > 2 * 1024 * 1024) throw new Error('QQ Music lyrics exceed size limit');
                chunks.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        const result = new Uint8Array(size); let cursor = 0;
        for (const chunk of chunks) { result.set(chunk,cursor); cursor += chunk.length; }
        return new TextDecoder('utf-8', {fatal:true}).decode(result).replace(/^\uFEFF/, '');
    }
    async function decrypt(hex) {
        if (typeof DecompressionStream !== 'function') throw new Error('QRC requires browser zlib support');
        const bytes = decryptBytes(hex);
        // A zlib stream is padded to an 8-byte cipher block. Native browser
        // decoders reject those trailing zeros; try only the possible padding
        // lengths, keeping a checksum which itself ends in zero intact.
        let failure;
        for (let padding = 0; padding < 8; padding++) {
            if (padding && bytes[bytes.length - padding] !== 0) break;
            try { return await inflate(bytes.subarray(0, bytes.length - padding)); }
            catch (error) { failure = error; }
        }
        throw failure;
    }
    window.ivLyricsQQMusicCodec = Object.freeze({decrypt});
})();
