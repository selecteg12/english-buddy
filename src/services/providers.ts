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
    synonyms: [...new Set([...(meaning.synonyms ?? []), ...meaning.definitions.flatMap(d => d.synonyms ?? [])])].filter(s => s.length <= 80).slice(0, 8),
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
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(6500), redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'EnglishBuddy/0.1 (Windows vocabulary companion)' } });
      if (!response.ok) {
        const error = new Error(response.status === 404 ? 'This word is not in the dictionary.' : `Vocabulary service returned HTTP ${response.status}.`);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await new Promise(r => setTimeout(r, 650)); continue; }
        throw error;
      }
      const text = await response.text();
      if (text.length > 1000000) throw new Error('Vocabulary response is too large.');
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (attempt === 0 && (error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)))) { await new Promise(r => setTimeout(r, 650)); continue; }
      throw error;
    }
  }
  throw new Error('The vocabulary service is unavailable.');
}
export class FreeDictionary implements DictionaryProvider {
  async lookup(word: string) { return parseDictionary(await requestJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(requireWord(word))}`)); }
}
export class MyMemory implements TranslationProvider {
  async translate(word: string): Promise<TranslationData> { return { text: parseTranslation(await requestJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(requireWord(word))}&langpair=en%7Cru`)), sources: [{ name: 'MyMemory translation', url: 'https://mymemory.translated.net/' }] }; }
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
  constructor(private fallback: TranslationProvider = new MyMemory()) {}
  async translate(word: string): Promise<TranslationData> {
    const validated = requireWord(word);
    try {
      const data = await requestJson(`https://en.wiktionary.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(validated)}&format=json&formatversion=2`);
      const result = parseWiktionary(data);
      result.sources[0].url = `https://en.wiktionary.org/wiki/${encodeURIComponent(validated)}`;
      return result;
    } catch { return this.fallback.translate(validated); }
  }
}
