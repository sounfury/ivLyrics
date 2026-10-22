/** Shared alignment for human lyric translations (NetEase and QQ Music). */
(() => {
    'use strict';
    const BLANK_TRANSLATION = '\u200B';
    const FUZZY_THRESHOLD = 0.7;
    function normalizeText(text) {
        return String(text ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[’‘`´]/g, "'")
            .replace(/[^\p{L}\p{N}]+/gu, '');
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

    window.ivLyricsHumanTranslation = Object.freeze({normalizeText, alignTranslations});
})();
