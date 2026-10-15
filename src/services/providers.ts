import { z } from 'zod';
import type { Vocabulary } from '../shared/schema';
import { requireWord } from '../shared/validation';

const definitionSchema = z.object({ definition: z.string().min(1).max(3000), example: z.string().max(1500).optional(), synonyms: z.array(z.string().max(80)).optional() });
const dictionarySchema = z.array(z.object({
  word: z.string(), phonetic: z.string().optional(), phonetics: z.array(z.object({ text: z.string().optional() })).optional(),
  meanings: z.array(z.object({ partOfSpeech: z.string(), synonyms: z.array(z.string()).optional(), definitions: z.array(definitionSchema) })),
  license: z.object({ name: z.string(), url: z.string() }).optional(), sourceUrls: z.array(z.string()).optional()
}));
export type DictionaryData = Pick<Vocabulary, 'definition' | 'partOfSpeech' | 'synonyms' | 'ipa' | 'example' | 'sources'>;
export interface TranslationData { text: string; sources: Vocabulary['sources']; synonyms?: string[] }
export interface DictionaryProvider { lookup(word: string): Promise<DictionaryData> }
export interface TranslationProvider { translate(word: string): Promise<TranslationData> }
export interface SynonymData { synonyms: string[]; sources: Vocabulary['sources'] }
export interface SynonymProvider { lookup(word: string): Promise<SynonymData> }

export function englishSynonyms(words: string[], selected = ''): string[] {
  const normalized = words.map(word => word.trim().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').toLowerCase());
  return [...new Set(normalized)].filter(word => word !== selected && word.length <= 80 && /^[a-z]+(?:[ '-][a-z]+)*$/.test(word)).slice(0, 8);
}

export function parseSynonyms(input: unknown, selected: string): SynonymData {
  const entries = z.array(z.object({ word: z.string().max(80), tags: z.array(z.string().max(100)).max(30).optional() })).max(1000).parse(input);
  const frequency = (tags: string[] = []) => {
    const value = Number(tags.find(tag => tag.startsWith('f:'))?.slice(2) ?? 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const ordered = [...entries].sort((a, b) => frequency(b.tags) - frequency(a.tags));
  return { synonyms: englishSynonyms(ordered.map(entry => entry.word), selected), sources: [{ name: 'Datamuse / WordNet synonyms', url: 'https://www.datamuse.com/api/' }] };
}

export class DatamuseSynonyms implements SynonymProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async lookup(word: string): Promise<SynonymData> {
    const selected = requireWord(word);
    return parseSynonyms(await requestJson(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(selected)}&max=24&md=f`, this.fetcher), selected);
  }
}

export function parseDictionary(input: unknown): DictionaryData {
  const entries = dictionarySchema.parse(input);
  const candidates = entries.flatMap(e => e.meanings.map(m => ({ entry: e, meaning: m }))).filter(item => item.meaning.definitions.length);
  // Prefer an unlabelled meaning over a leading parenthetical specialty sense.
  const chosen = candidates.find(item => !item.meaning.definitions[0].definition.startsWith('(')) ?? candidates[0];
  if (!chosen) throw new Error('No English definition was found.');
  const { entry, meaning } = chosen;
  const definition = meaning.definitions[0];
  return {
    definition: definition.definition, partOfSpeech: meaning.partOfSpeech.slice(0, 60),
    synonyms: englishSynonyms([...(meaning.synonyms ?? []), ...meaning.definitions.flatMap(d => d.synonyms ?? [])], requireWord(entry.word)),
    ipa: (entry.phonetic ?? entry.phonetics?.find(p => p.text)?.text ?? '').slice(0, 150), example: definition.example ?? '',
    sources: [{ name: 'Free Dictionary / Wiktionary', url: 'https://dictionaryapi.dev/', license: entry.license?.name.slice(0, 120), licenseUrl: entry.license?.url },
      { name: 'Wiktionary entry', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(requireWord(entry.word))}` }]
  };
}
export function parseTranslation(input: unknown): string {
  const data = z.object({ responseStatus: z.union([z.number(), z.string()]), quotaFinished: z.boolean().optional(), responseData: z.object({ translatedText: z.string().max(2000) }) }).parse(input);
  if (Number(data.responseStatus) !== 200 || data.quotaFinished || !/[а-яё]/i.test(data.responseData.translatedText)) throw new Error('Russian translation is unavailable or the daily quota has been reached.');
  return data.responseData.translatedText.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

export async function requestJson(url: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  const signal = AbortSignal.timeout(4000);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'EnglishBuddy/0.1 (Windows vocabulary companion)' } });
      if (!response.ok) {
        const error = new Error(response.status === 404 ? 'This word is not in the dictionary.' : `Vocabulary service returned HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await new Promise(r => setTimeout(r, 150)); continue; }
        throw error;
      }
      const text = await response.text();
      if (text.length > 1000000) throw new Error('Vocabulary response is too large.');
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (attempt === 0 && !signal.aborted && error instanceof TypeError) { await new Promise(r => setTimeout(r, 150)); continue; }
      throw error;
    }
  }
  throw new Error('The vocabulary service is unavailable.');
}
export class FreeDictionary implements DictionaryProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async lookup(word: string) { return parseDictionary(await requestJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(requireWord(word))}`, this.fetcher)); }
}
export class MyMemory implements TranslationProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async translate(word: string): Promise<TranslationData> { return { text: parseTranslation(await requestJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(requireWord(word))}&langpair=en%7Cru`, this.fetcher)), sources: [{ name: 'MyMemory translation', url: 'https://mymemory.translated.net/' }] }; }
}

// A slow primary must not delay a healthy fallback. The first valid result wins.
export function hedged<T>(primary: () => Promise<T>, fallback: () => Promise<T>, delay = 350): Promise<T> {
  return new Promise((resolve, reject) => {
    let started = false, finished = false, failures = 0;
    const success = (value: T) => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const failure = () => { if (++failures === 2 && !finished) { finished = true; reject(new Error('Both vocabulary sources are unavailable.')); } };
    const startFallback = () => { if (started || finished) return; started = true; void Promise.resolve().then(fallback).then(success, failure); };
    const timer = setTimeout(startFallback, delay);
    void Promise.resolve().then(primary).then(success, () => { failure(); clearTimeout(timer); startFallback(); });
  });
}

export function dictionaryText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const value = entity.slice(2, -1), point = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    }).replace(/\s+/g, ' ').trim();
}
export function parseWiktionaryDefinition(input: unknown, word: string): DictionaryData {
  const validated = requireWord(word);
  const data = z.object({ en: z.array(z.object({ partOfSpeech: z.string().max(60), definitions: z.array(z.object({ definition: z.string().max(20000), examples: z.array(z.string().max(20000)).optional() })).max(500) })).max(100) }).parse(input);
  const candidates = data.en.flatMap(entry => entry.definitions.map(item => ({ definition: dictionaryText(item.definition), example: dictionaryText(item.examples?.[0] ?? ''), partOfSpeech: entry.partOfSpeech.toLowerCase() }))).filter(item => item.definition.length > 0 && item.definition.length <= 3000);
  const chosen = candidates.find(item => !item.definition.startsWith('(')) ?? candidates[0];
  if (!chosen) throw new Error('No English definition was found.');
  return { ...chosen, example: chosen.example.slice(0, 1500), ipa: '', synonyms: [], sources: [{ name: 'Wiktionary definition', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(validated)}`, license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }] };
}
export class WiktionaryDictionary implements DictionaryProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  async lookup(word: string) {
    const validated = requireWord(word);
    return parseWiktionaryDefinition(await requestJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(validated)}`, this.fetcher), validated);
  }
}
export class ResilientDictionary implements DictionaryProvider {
  constructor(private primary: DictionaryProvider = new FreeDictionary(), private fallback: DictionaryProvider = new WiktionaryDictionary()) {}
  lookup(word: string) { const validated = requireWord(word); return hedged(() => this.primary.lookup(validated), () => this.fallback.lookup(validated)); }
}

export function parseWiktionary(input: unknown): TranslationData {
  const data = z.object({ query: z.object({ pages: z.array(z.object({ revisions: z.array(z.object({ slots: z.object({ main: z.object({ content: z.string().max(1000000) }) }) })).optional() })) }) }).parse(input);
  const content = data.query.pages[0]?.revisions?.[0]?.slots.main.content ?? '';
  const english = content.split(/^==English==\s*$/m)[1]?.split(/^==[^=\n]+==\s*$/m)[0] ?? '';
  const translations = [...english.matchAll(/\{\{t(?:\+|-|ø|\+check|check)?\|ru\|([^|}\n]+)/g)]
    .map(match => match[1].replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1').replace(/\u0301/g, '').trim())
    .filter(text => text.length <= 80 && /^[а-яёА-ЯЁ ,;-]+$/.test(text));
  if (!translations.length) throw new Error('No Russian Wiktionary translation found.');
  const synonyms = [...english.matchAll(/\{\{syn\|en\|([^}\n]+)\}\}/g)]
    .flatMap(match => match[1].split('|')).map(item => item.trim()).filter(item => /^[a-z]+(?:[-'][a-z]+)*$/.test(item));
  return { text: [...new Set(translations)].slice(0, 6).join('; '), synonyms: [...new Set(synonyms)].slice(0, 8), sources: [{ name: 'Wiktionary translation', url: 'https://en.wiktionary.org/', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' }] };
}
export class WiktionaryTranslation implements TranslationProvider {
  constructor(private fallback: TranslationProvider = new MyMemory(), private fetcher: typeof fetch = fetch) {}
  async translate(word: string): Promise<TranslationData> {
    const validated = requireWord(word);
    return hedged(async () => {
      const data = await requestJson(`https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(validated)}&format=json&formatversion=2`, this.fetcher);
      const result = parseWiktionary(data);
      result.sources[0].url = `https://en.wiktionary.org/wiki/${encodeURIComponent(validated)}`;
      return result;
    }, () => this.fallback.translate(validated));
  }
}
