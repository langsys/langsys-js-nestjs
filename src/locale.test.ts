import { describe, expect, it } from 'vitest';
import { matchSupported, parseAcceptLanguage, resolveLocale } from './locale.js';

const SUPPORTED = ['en-US', 'es-ES', 'fr-FR', 'de-DE'];

describe('parseAcceptLanguage', () => {
    it('orders tags by q descending', () => {
        expect(parseAcceptLanguage('fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5')).toEqual([
            'fr-CH',
            'fr',
            'en',
            'de',
        ]);
    });

    it('drops wildcard and zero-q tags', () => {
        expect(parseAcceptLanguage('*;q=0.5, es;q=0')).toEqual([]);
    });
});

describe('matchSupported', () => {
    it('matches exact canonical tags case-insensitively', () => {
        expect(matchSupported('es-es', SUPPORTED)).toBe('es-ES');
    });

    it('falls back to a language-prefix match', () => {
        expect(matchSupported('fr-CA', SUPPORTED)).toBe('fr-FR');
        expect(matchSupported('de', SUPPORTED)).toBe('de-DE');
    });

    it('returns null when nothing matches', () => {
        expect(matchSupported('ja-JP', SUPPORTED)).toBeNull();
    });
});

describe('resolveLocale', () => {
    const config = { defaultLocale: 'en-US', supportedLocales: SUPPORTED };

    it('prefers the query param over everything', () => {
        expect(
            resolveLocale({ query: 'es-ES', cookie: 'fr-FR', acceptLanguage: 'de-DE' }, config)
        ).toBe('es-ES');
    });

    it('falls back to the cookie, then Accept-Language, then default', () => {
        expect(resolveLocale({ cookie: 'fr-FR', acceptLanguage: 'de-DE' }, config)).toBe('fr-FR');
        expect(resolveLocale({ acceptLanguage: 'de-DE, en;q=0.5' }, config)).toBe('de-DE');
        expect(resolveLocale({}, config)).toBe('en-US');
    });

    it('skips unsupported candidates rather than serving them', () => {
        expect(resolveLocale({ query: 'ja-JP', acceptLanguage: 'fr-FR' }, config)).toBe('fr-FR');
    });

    it('trusts sources verbatim when no supportedLocales are configured', () => {
        expect(resolveLocale({ query: 'ja-jp' }, { defaultLocale: 'en-US' })).toBe('ja-JP');
    });
});
