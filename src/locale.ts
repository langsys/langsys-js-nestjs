import { canonicalizeLocale } from 'langsys-js-typescript';

/**
 * Framework-agnostic request-locale resolution: explicit query param, then
 * the persisted cookie, then Accept-Language, then the default. Mirrors the
 * precedence the Laravel and Symfony bindings use, so a visitor moving
 * between a JS and PHP property gets the same locale decision.
 */

export interface LocaleResolutionConfig {
    /** Fallback when nothing matches. */
    defaultLocale: string;
    /**
     * Locales the app actually serves. When set, every source is matched
     * against it (exact canonical tag first, then language prefix — 'fr'
     * matches 'fr-FR'). When omitted, sources are trusted verbatim.
     */
    supportedLocales?: string[];
}

export interface LocaleSources {
    /** ?locale= value, if present. */
    query?: string | null;
    /** Persisted cookie value, if present. */
    cookie?: string | null;
    /** Raw Accept-Language header, if present. */
    acceptLanguage?: string | null;
}

/** Parse an Accept-Language header into tags, highest q first. */
export function parseAcceptLanguage(header: string): string[] {
    return header
        .split(',')
        .map((part) => {
            const [tag, ...params] = part.trim().split(';');
            const qParam = params.find((p) => p.trim().startsWith('q='));
            const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
            return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0 };
        })
        .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
        .sort((a, b) => b.q - a.q)
        .map(({ tag }) => tag);
}

/** Match a candidate tag against the supported list: exact canonical, then language prefix. */
export function matchSupported(candidate: string, supported: string[]): string | null {
    const canonical = canonicalizeLocale(candidate);
    const canonicalSupported = supported.map((s) => canonicalizeLocale(s));

    const exact = canonicalSupported.findIndex((s) => s === canonical);
    if (exact !== -1) return canonicalSupported[exact];

    const language = canonical.split('-')[0];
    const prefix = canonicalSupported.findIndex((s) => s.split('-')[0] === language);
    if (prefix !== -1) return canonicalSupported[prefix];

    return null;
}

export function resolveLocale(sources: LocaleSources, config: LocaleResolutionConfig): string {
    const candidates: string[] = [];
    if (sources.query) candidates.push(sources.query);
    if (sources.cookie) candidates.push(sources.cookie);
    if (sources.acceptLanguage) candidates.push(...parseAcceptLanguage(sources.acceptLanguage));

    for (const candidate of candidates) {
        if (!config.supportedLocales?.length) return canonicalizeLocale(candidate);
        const match = matchSupported(candidate, config.supportedLocales);
        if (match) return match;
    }
    return canonicalizeLocale(config.defaultLocale);
}
