import { afterEach, describe, expect, it, vi } from 'vitest';
import { hedged, parseWiktionaryDefinition, dictionaryText, requestJson, ResilientDictionary, WiktionaryTranslation, type DictionaryData } from '../src/services/providers';
import { VocabularyService } from '../src/services/vocabulary';
import { VocabularyCache } from '../src/services/cache';
import { vocabularySchema } from '../src/shared/schema';
const dictionary: DictionaryData = { definition: 'Dependable.', partOfSpeech: 'adjective', synonyms: [], sources: [], ipa: '', example: '' };
const translated = { text: 'последовательный', sources: [] };
const synonymData = { synonyms: ['uniform'], sources: [] };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Reliable English definitions', () => {
  it('extracts actual English definitions and examples as text with attribution', () => {
    const result = parseWiktionaryDefinition({ en: [{ partOfSpeech: 'Adjective', definitions: [{ definition: 'A <a href="/wiki/dependable">dependable</a> person.<style>hidden CSS</style>', examples: ['He is <b>consistent</b>.'] }] }], ru: [{ definitions: [{ definition: 'другой' }] }] }, 'consistent');
    expect(result.definition).toBe('A dependable person.'); expect(result.example).toBe('He is consistent.'); expect(result.partOfSpeech).toBe('adjective'); expect(result.sources[0]).toMatchObject({ license: 'CC BY-SA 4.0', url: 'https://en.wiktionary.org/wiki/consistent' });
  });
  it('removes active markup and decodes text entities without interpreting them', () => {
    expect(dictionaryText('<script>hidden</script><b>word</b> &amp; &#x41; &#39; &#1114112;')).toBe("word & A '");
    expect(dictionaryText('&lt;b&gt;')).toBe('<b>');
  });
  it('rejects missing English data and empty definitions', () => {
    expect(() => parseWiktionaryDefinition({ ru: [] }, 'consistent')).toThrow();
    expect(() => parseWiktionaryDefinition({ en: [{ partOfSpeech: 'Noun', definitions: [{ definition: '<style>hidden</style>' }] }] }, 'consistent')).toThrow();
  });
  it('uses the definition fallback while the primary remains unresponsive', async () => {
    vi.useFakeTimers();
    const fallback = vi.fn().mockResolvedValue(dictionary);
    const result = new ResilientDictionary({ lookup: () => new Promise(() => {}) }, { lookup: fallback }).lookup('consistent');
    await vi.advanceTimersByTimeAsync(349); expect(fallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await expect(result).resolves.toEqual(dictionary);
  });
});
describe('Bounded requests and early fallbacks', () => {
  it('does not send a fallback request when the primary responds quickly', async () => {
    vi.useFakeTimers(); const fallback = vi.fn();
    await expect(hedged(() => Promise.resolve('primary'), fallback)).resolves.toBe('primary');
    await vi.advanceTimersByTimeAsync(1000); expect(fallback).not.toHaveBeenCalled();
  });
  it('starts the fallback immediately after a primary failure', async () => {
    vi.useFakeTimers(); const fallback = vi.fn().mockResolvedValue('fallback');
    await expect(hedged(() => Promise.reject(new Error()), fallback)).resolves.toBe('fallback'); expect(fallback).toHaveBeenCalledOnce();
  });
  it('reports failure if both sources fail', async () => {
    await expect(hedged(() => Promise.reject(new Error()), () => Promise.reject(new Error()))).rejects.toThrow('Both');
  });
  it('uses the translation fallback without waiting for a blocked Wiktionary request', async () => {
    vi.useFakeTimers(); const fallback = vi.fn().mockResolvedValue(translated);
    const result = new WiktionaryTranslation({ translate: fallback }, () => new Promise(() => {})).translate('consistent');
    await vi.advanceTimersByTimeAsync(350); await expect(result).resolves.toEqual(translated);
  });
  it('shares a four-second total deadline across transient retries', async () => {
    vi.useFakeTimers(); let attempts = 0;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay); return controller.signal; });
    const fetcher = vi.fn<typeof fetch>((_url, options) => {
      if (++attempts === 1) return Promise.resolve(new Response('{}', { status: 503 }));
      return new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
    });
    const result = expect(requestJson('https://example.test', fetcher)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(4000); await result; expect(attempts).toBe(2);
  });
});
describe('Progressive vocabulary and partial cache', () => {
  it('publishes translation before a slow definition and then completes the card', async () => {
    let finish!: (value: DictionaryData) => void;
    const updates = vi.fn();
    const service = new VocabularyService({ lookup: () => new Promise(resolve => { finish = resolve; }) }, { translate: async () => translated }, new VocabularyCache(), { lookup: async () => synonymData });
    const pending = service.lookup('consistent', true, updates);
    await Promise.resolve(); await Promise.resolve();
    expect(updates.mock.calls.some(([entry, fields]) => entry.translation === translated.text && fields.includes('definition'))).toBe(true);
    finish(dictionary); await expect(pending).resolves.toMatchObject({ definition: 'Dependable.', translation: translated.text });
    expect(updates.mock.lastCall?.[1]).toEqual([]);
  });
  it('subscribes duplicate callers to current progress without duplicate requests', async () => {
    let finish!: (value: DictionaryData) => void;
    const lookup = vi.fn(() => new Promise<DictionaryData>(resolve => { finish = resolve; })), secondUpdates = vi.fn();
    const service = new VocabularyService({ lookup }, { translate: async () => translated }, new VocabularyCache());
    const first = service.lookup('consistent'); await Promise.resolve();
    const second = service.lookup('consistent', true, secondUpdates);
    expect(second).toBe(first); expect(secondUpdates).toHaveBeenCalled(); expect(lookup).toHaveBeenCalledOnce();
    finish(dictionary); await second;
  });
  it('retries only missing fields and keeps successful data available offline', async () => {
    const lookup = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValue(dictionary), translate = vi.fn().mockResolvedValue(translated), synonyms = vi.fn().mockResolvedValue(synonymData), cache = new VocabularyCache();
    const service = new VocabularyService({ lookup }, { translate }, cache, { lookup: synonyms });
    await service.lookup('consistent');
    await expect(service.lookup('consistent', false)).resolves.toMatchObject({ translation: translated.text, definition: '' });
    const updates = vi.fn(); await expect(service.lookup('consistent', true, updates)).resolves.toMatchObject({ definition: 'Dependable.', warnings: [] });
    expect(updates.mock.calls[0][0].translation).toBe(translated.text); expect(lookup).toHaveBeenCalledTimes(2); expect(translate).toHaveBeenCalledOnce(); expect(synonyms).toHaveBeenCalledOnce();
  });
  it('repairs an incomplete cached entry even if its synonyms were checked', async () => {
    const cache = new VocabularyCache(); cache.set(vocabularySchema.parse({ word: 'consistent', translation: translated.text, synonymsChecked: true, fetchedAt: Date.now() }));
    const lookup = vi.fn().mockResolvedValue(dictionary), translate = vi.fn();
    const service = new VocabularyService({ lookup }, { translate }, cache);
    await expect(service.lookup('consistent')).resolves.toMatchObject({ definition: 'Dependable.' }); expect(lookup).toHaveBeenCalledOnce(); expect(translate).not.toHaveBeenCalled();
  });
  it('isolates subscriber mutations and ignores a closed subscriber', async () => {
    const service = new VocabularyService({ lookup: async () => dictionary }, { translate: async () => translated }, new VocabularyCache());
    await expect(service.lookup('consistent', true, entry => { entry.definition = 'mutated'; throw new Error('closed'); })).resolves.toMatchObject({ definition: 'Dependable.' });
  });
});
