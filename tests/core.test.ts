import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { normalizeWord, requireWord, allowedSource } from '../src/shared/validation';
import { settingsPatchSchema, settingsSchema, vocabularySchema } from '../src/shared/schema';
import { clampRect, popupBounds } from '../src/shared/geometry';
import { LocalStore } from '../src/storage/store';
import { VocabularyCache } from '../src/services/cache';
import { DatamuseSynonyms, englishSynonyms, parseDictionary, parseTranslation, parseWiktionary, parseSynonyms, requestJson, type DictionaryData } from '../src/services/providers';
import { VocabularyService } from '../src/services/vocabulary';

const folders: string[] = [];
const testRoot = resolve('artifacts/test-data');
const directory = () => { mkdirSync(testRoot, { recursive: true }); const path = mkdtempSync(join(testRoot, 'case-')); folders.push(path); return path; };
afterEach(() => { vi.useRealTimers(); for (const path of folders.splice(0)) { if (!resolve(path).startsWith(testRoot + sep)) throw new Error('Unsafe cleanup path'); rmSync(path, { recursive: true, force: true }); } });
const entry = () => vocabularySchema.parse({ word: 'consistent', definition: 'Acting in the same way.', translation: 'последовательный', synonyms: ['steady'], fetchedAt: Date.now() });
const dictionary: DictionaryData = { definition: 'Acting in the same way.', partOfSpeech: 'adjective', synonyms: ['steady'], ipa: '/kənˈsɪstənt/', example: '', sources: [] };
const translated = { text: 'последовательный', sources: [] };

describe('Selected text and IPC boundary', () => {
  it('normalizes case, edge whitespace and typographic apostrophes', () => { expect(normalizeWord(' \nConsistent\t')).toBe('consistent'); expect(normalizeWord('Don’t')).toBe("don't"); expect(normalizeWord('well-known')).toBe('well-known'); });
  it.each(['two words', '', '123', 'a@b.com', 'русский', '<script>', 'a'.repeat(65), 'hello\nworld', null, {}, 'word-', "a''b"] as unknown[])('rejects unsuitable selections: %s', input => expect(normalizeWord(input)).toBeNull());
  it('throws before a provider can receive arbitrary input', () => expect(() => requireWord('secret private text')).toThrow());
  it('validates settings and rejects unexpected IPC fields', () => {
    expect(() => settingsPatchSchema.parse({ popupTimeout: -1 })).toThrow();
    expect(() => settingsPatchSchema.parse({ monitoring: 'true' })).toThrow();
    expect(() => settingsPatchSchema.parse({ path: 'C:\\' })).toThrow();
    expect(() => settingsPatchSchema.parse({ position: { x: 1, y: 2 } })).toThrow();
    expect(settingsSchema.parse({}).launchAtStartup).toBe(false);
    expect(settingsPatchSchema.parse({ mode: 'en' })).toEqual({ mode: 'en' });
  });
  it('allows only named HTTPS attribution sources', () => {
    expect(allowedSource('https://dictionaryapi.dev/')).toBe('https://dictionaryapi.dev/');
    for (const url of ['javascript:alert(1)', 'https://evil.com/', 'file:///C:/Windows', 'https://user@dictionaryapi.dev/', 'https://dictionaryapi.dev:123/']) expect(() => allowedSource(url)).toThrow();
  });
});
describe('Provider parsing and request failures', () => {
  it('parses meaning-level and definition-level synonyms with attribution', () => {
    const result = parseDictionary([{ word: 'consistent', phonetics: [{ text: '/ipa/' }], meanings: [{ partOfSpeech: 'adjective', synonyms: ['steady'], definitions: [{ definition: 'Always the same.', synonyms: ['steady', 'reliable'] }] }], license: { name: 'CC BY-SA 3.0', url: 'https://example.test/license' } }]);
    expect(result.synonyms).toEqual(['steady', 'reliable']); expect(result.ipa).toBe('/ipa/'); expect(result.sources[0].license).toBe('CC BY-SA 3.0');
  });
  it('rejects malformed dictionary data and an empty dictionary', () => { expect(() => parseDictionary({ message: 'missing' })).toThrow(); expect(() => parseDictionary([])).toThrow(); });
  it('prefers a general meaning over a labelled specialty meaning', () => { expect(parseDictionary([{ word: 'consistent', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: '(in the plural) Rare sense.' }] }, { partOfSpeech: 'adjective', definitions: [{ definition: 'Dependable.' }] }] }]).partOfSpeech).toBe('adjective'); });
  it('extracts only English-section Russian translations and synonyms from Wiktionary', () => { const result = parseWiktionary({ query: { pages: [{ revisions: [{ slots: { main: { content: "==English==\n===Adjective===\n{{t+|ru|после́довательный}}\n{{syn|en|reliable|steady}}\n==Dutch==\n{{t+|ru|другой}}" } } }] }] } }); expect(result.text).toBe('последовательный'); expect(result.synonyms).toEqual(['reliable', 'steady']); });
  it('accepts a Russian translation and decodes entities', () => expect(parseTranslation({ responseStatus: '200', responseData: { translatedText: 'слово &quot;текст&quot;' } })).toBe('слово "текст"'));
  it('rejects quota errors and an untranslated English response', () => {
    expect(() => parseTranslation({ responseStatus: 429, responseData: { translatedText: 'limit' } })).toThrow();
    expect(() => parseTranslation({ responseStatus: 200, responseData: { translatedText: 'consistent' } })).toThrow();
  });
  it('does not retry a missing word', async () => { const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 404 })); await expect(requestJson('https://example.test', fetcher)).rejects.toThrow('not in'); expect(fetcher).toHaveBeenCalledTimes(1); });
  it('retries a transient failure only once', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{"ok":true}'));
    expect(await requestJson('https://example.test', fetcher)).toEqual({ ok: true }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
describe('English synonyms', () => {
  it('normalizes English terms, keeps phrases and rejects other languages and the original word', () => {
    expect(englishSynonyms([' Happy ', ' Bright ', 'bright', 'счастливый', 'at   peace', '<script>', 'a@b.com'], 'happy')).toEqual(['bright', 'at peace']);
  });
  it('prioritizes common synonyms using provider frequency metadata', () => {
    const data = parseSynonyms([{ word: 'halcyon', tags: ['f:0.1'] }, { word: 'content', tags: ['f:80'] }, { word: 'bright', tags: ['f:25'] }, { word: 'happy', tags: ['f:100'] }, { word: 'счастливый', tags: ['f:90'] }], 'happy');
    expect(data.synonyms).toEqual(['content', 'bright', 'halcyon']);
    expect(data.sources[0].url).toBe('https://www.datamuse.com/api/');
  });
  it('rejects malformed responses and accepts a legitimate empty result', () => {
    expect(() => parseSynonyms({ word: 'bright' }, 'happy')).toThrow();
    expect(() => parseSynonyms([{ word: 3 }], 'happy')).toThrow();
    expect(parseSynonyms([], 'happy').synonyms).toEqual([]);
  });
  it('never sends unvalidated selected text to the synonym service', async () => {
    const fetcher = vi.fn();
    await expect(new DatamuseSynonyms(fetcher).lookup('private selected phrase')).rejects.toThrow('one English word');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requests actual synonym relations and frequency metadata with a normalized word', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ word: 'uniform', tags: ['f:20'] }])));
    expect((await new DatamuseSynonyms(fetcher).lookup(' Consistent ')).synonyms).toEqual(['uniform']);
    expect(fetcher.mock.calls[0][0]).toContain('rel_syn=consistent&max=24&md=f');
  });
  it('enriches legacy cached data once without reloading translation or definition', async () => {
    const cache = new VocabularyCache(); cache.set({ ...entry(), synonyms: [] });
    const lookup = vi.fn(), translate = vi.fn(), synonyms = vi.fn().mockResolvedValue({ synonyms: ['uniform', 'coherent'], sources: [] });
    const service = new VocabularyService({ lookup }, { translate }, cache, { lookup: synonyms });
    const updated = await service.lookup('consistent');
    expect(updated.synonyms).toEqual(['uniform', 'coherent']); expect(updated.translation).toBe('последовательный'); expect(updated.synonymsChecked).toBe(true);
    await service.lookup('consistent'); expect(synonyms).toHaveBeenCalledTimes(1); expect(lookup).not.toHaveBeenCalled(); expect(translate).not.toHaveBeenCalled();
  });
  it('preserves old cached words offline without making a synonym request', async () => {
    const cache = new VocabularyCache(); cache.set(entry()); const synonyms = vi.fn();
    const service = new VocabularyService({ lookup: vi.fn() }, { translate: vi.fn() }, cache, { lookup: synonyms });
    await expect(service.lookup('consistent', false)).resolves.toMatchObject({ synonyms: ['steady'] }); expect(synonyms).not.toHaveBeenCalled();
  });
  it('keeps dictionary synonyms when the additional service fails', async () => {
    const service = new VocabularyService({ lookup: vi.fn().mockResolvedValue(dictionary) }, { translate: vi.fn().mockResolvedValue(translated) }, new VocabularyCache(), { lookup: vi.fn().mockRejectedValue(new Error('offline')) });
    const result = await service.lookup('consistent'); expect(result.synonyms).toEqual(['steady']); expect(result.warnings).toEqual([]);
  });
  it('returns real synonyms even if the other vocabulary services are unavailable', async () => {
    const service = new VocabularyService({ lookup: vi.fn().mockRejectedValue(new Error()) }, { translate: vi.fn().mockRejectedValue(new Error()) }, new VocabularyCache(), { lookup: vi.fn().mockResolvedValue({ synonyms: ['uniform'], sources: [] }) });
    const result = await service.lookup('consistent'); expect(result.synonyms).toEqual(['uniform']); expect(result.definition).toBe(''); expect(result.translation).toBe(''); expect(result.warnings).toHaveLength(2);
  });
  it('reports synonym failure without poisoning the cache and retries on the next lookup', async () => {
    const synonyms = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue({ synonyms: ['uniform'], sources: [] });
    const cache = new VocabularyCache();
    const service = new VocabularyService({ lookup: vi.fn().mockResolvedValue({ ...dictionary, synonyms: [] }) }, { translate: vi.fn().mockResolvedValue(translated) }, cache, { lookup: synonyms });
    const first = await service.lookup('consistent'); expect(first.warnings.join(' ')).toContain('English synonyms'); expect(cache.get('consistent')).toBeUndefined();
    expect((await service.lookup('consistent')).synonyms).toEqual(['uniform']);
  });
});
describe('Cache', () => {
  it('persists, expires, clears and returns isolated entries', () => {
    vi.useFakeTimers(); const file = join(directory(), 'cache.json'); const cache = new VocabularyCache(file, 1000);
    cache.set(entry()); const copy = cache.get('consistent')!; copy.translation = 'changed'; expect(cache.get('consistent')!.translation).toBe('последовательный');
    const reloaded = new VocabularyCache(file, 1000); expect(reloaded.get('consistent')).toBeDefined();
    vi.advanceTimersByTime(1001); expect(reloaded.get('consistent')).toBeUndefined();
    cache.clear(); expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
  });
  it('evicts the oldest entry at its size limit', () => { const cache = new VocabularyCache(undefined, 1000, 1); cache.set(entry()); cache.set({ ...entry(), word: 'steady' }); expect(cache.get('consistent')).toBeUndefined(); });
});
describe('Vocabulary orchestration', () => {
  it('deduplicates simultaneous lookups and reuses data across modes', async () => {
    const lookup = vi.fn().mockResolvedValue(dictionary), translate = vi.fn().mockResolvedValue(translated);
    const service = new VocabularyService({ lookup }, { translate }, new VocabularyCache());
    const [a, b] = await Promise.all([service.lookup('Consistent'), service.lookup('consistent')]); expect(a).toEqual(b); expect(lookup).toHaveBeenCalledTimes(1);
    await service.lookup('consistent'); expect(translate).toHaveBeenCalledTimes(1);
    const mode = settingsSchema.parse({ mode: 'en' }).mode; expect(mode === 'en' ? a.definition : a.translation).toBe(dictionary.definition);
  });
  it('uses cached words offline without a provider call', async () => { const cache = new VocabularyCache(); cache.set(entry()); const lookup = vi.fn(); const service = new VocabularyService({ lookup }, { translate: vi.fn() }, cache); await expect(service.lookup('consistent', false)).resolves.toBeDefined(); expect(lookup).not.toHaveBeenCalled(); await expect(service.lookup('uncached', false)).rejects.toThrow('Offline'); });
  it('surfaces partial failure and allows it to be retried', async () => {
    const translate = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(translated);
    const service = new VocabularyService({ lookup: vi.fn().mockResolvedValue(dictionary) }, { translate }, new VocabularyCache());
    const partial = await service.lookup('consistent'); expect(partial.translation).toBe(''); expect(partial.warnings).toHaveLength(1);
    expect((await service.lookup('consistent')).translation).toBe('последовательный');
  });
  it('propagates a complete service failure', async () => { const service = new VocabularyService({ lookup: vi.fn().mockRejectedValue(new Error()) }, { translate: vi.fn().mockRejectedValue(new Error()) }, new VocabularyCache()); await expect(service.lookup('consistent')).rejects.toThrow('Could not reach'); });
  it('does not repopulate a cleared cache with an in-flight result', async () => {
    let resolveRequest!: (data: DictionaryData) => void;
    const cache = new VocabularyCache(); const service = new VocabularyService({ lookup: () => new Promise(resolve => { resolveRequest = resolve; }) }, { translate: vi.fn().mockResolvedValue(translated) }, cache);
    const pending = service.lookup('consistent'); service.clear(); resolveRequest(dictionary); await pending; expect(cache.get('consistent')).toBeUndefined();
  });
});
describe('Persistent local settings and vocabulary', () => {
  it('persists the mode and settings across restarts without resetting unrelated fields', () => { const path = directory(); const store = new LocalStore(path); store.updateSettings({ mode: 'en', popupTimeout: 30, monitoring: false, onboardingComplete: true }); store.updateSettings({ animation: false }); const next = new LocalStore(path); expect(next.snapshot().settings.mode).toBe('en'); expect(next.snapshot().settings.monitoring).toBe(false); expect(next.snapshot().settings.onboardingComplete).toBe(true); expect(next.snapshot().settings.popupTimeout).toBe(30); });
  it('saves once, persists records and removes them', () => { const path = directory(); const store = new LocalStore(path); store.save(entry()); store.save(entry()); expect(store.snapshot().words).toHaveLength(1); const next = new LocalStore(path); expect(next.snapshot().words[0].translation).toBe('последовательный'); next.remove('Consistent'); expect(new LocalStore(path).snapshot().words).toHaveLength(0); });
  it('preserves a damaged file and informs the user', () => { const path = directory(); writeFileSync(join(path, 'buddy.json'), '{broken'); const store = new LocalStore(path); expect(store.warning).toContain('preserved'); expect(store.snapshot().words).toEqual([]); });
});
describe('Screen positioning', () => {
  it('keeps the flag visible on a monitor with negative coordinates', () => expect(clampRect({ x: -2000, y: -20, width: 100, height: 108 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: -1920, y: 0, width: 100, height: 108 }));
  it('flips the popup below the flag at the top edge', () => { const bounds = popupBounds({ x: 950, y: 0, width: 100, height: 108 }, { x: 0, y: 0, width: 1024, height: 768 }); expect(bounds.y).toBe(116); expect(bounds.x + bounds.width).toBeLessThanOrEqual(1024); });
});
