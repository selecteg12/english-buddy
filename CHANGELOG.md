# Changes

## 0.1.2 — 15 October 2026

- Show Russian translations, English definitions and synonyms independently as each result arrives.
- Add real Wiktionary English definitions when Free Dictionary is unavailable.
- Start a fallback after 350 ms without waiting for the preferred provider to time out; use the first valid result.
- Use Electron's network stack with Windows proxy/PAC support and normal TLS verification.
- Limit each endpoint to four seconds in total, including transient retries.
- Cache healthy fields from partial results and retry only missing fields.
- Add loading states for individual fields and a Retry lookup button for unavailable meanings.
- Add regression coverage for blocked providers, English fallback parsing, progressive updates, incomplete cache repair and HTTP CONNECT proxy routing.
- Keep the 18 px English synonyms, saved vocabulary and preferences.
