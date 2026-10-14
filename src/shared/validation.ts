export function normalizeWord(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 256) return null;
  const word = input.trim().replace(/[‘’]/g, "'").toLowerCase();
  if (word.length > 64 || !/^[a-z]+(?:['-][a-z]+)*$/.test(word)) return null;
  return word;
}

export function requireWord(input: unknown): string {
  const word = normalizeWord(input);
  if (!word) throw new Error('Select one English word (up to 64 letters).');
  return word;
}

export function allowedSource(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1000) throw new Error('Invalid source.');
  const url = new URL(input);
  const hosts = ['dictionaryapi.dev', 'en.wiktionary.org', 'mymemory.translated.net', 'creativecommons.org'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new Error('Source is not allowed.');
  return url.href;
}
