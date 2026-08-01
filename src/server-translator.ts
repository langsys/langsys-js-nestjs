import {
    LangsysAppAPI,
    Logger,
    canonicalizeLocale,
    createSignal,
    interpolate,
    type TranslationParams,
    type iCategories,
    type iLangsysConfig,
    type iTranslations,
} from 'langsys-js-typescript';

/**
 * Multi-locale server translator built on the base SDK's exported pieces.
 *
 * The browser singleton (`LangsysApp`) holds ONE locale's catalog at a time —
 * correct for a browser tab, a race for a server handling concurrent requests
 * in different locales. This class keeps a locale-keyed catalog cache instead
 * and hands out per-locale `t()` functions, while reusing the base SDK's API
 * client, ICU interpolation, and locale canonicalization so lookup semantics
 * stay identical to every other binding.
 *
 * NOTE: this file is intentionally identical in langsys-js-nestjs and
 * langsys-js-hono (the frameworks differ only in the adapter layer). If it
 * grows, the right home is langsys-js-typescript itself — keep the copies in
 * sync until then.
 *
 * `LangsysAppAPI` is a module-level singleton, so one process serves one
 * Langsys project — the standard server deployment shape. Constructing a
 * second LangsysServer with a different projectid logs a warning and the
 * last configuration wins.
 */

export interface LangsysServerOptions {
    projectid: string;
    /** Write key on trusted servers (enables phrase registration); read-only key otherwise. */
    key: string;
    /** Locale your source phrases are written in. Default 'en'. */
    baseLocale?: string;
    /** Point the SDK at a different API host (staging, local instance). */
    apiUrl?: string;
    /** Seconds a fetched catalog stays fresh before a lazy refetch. Default 300. */
    catalogTtlSeconds?: number;
    /** Seconds before retrying after a failed fetch or authorization. Default 30. */
    errorRetrySeconds?: number;
    debug?: boolean;
}

/** Same call shapes as the base SDK's TFunction, bound to one locale. */
export interface ServerTFunction {
    (phrase: string): string;
    (phrase: string, params: TranslationParams): string;
    (phrase: string, category: string): string;
    (phrase: string, category: string, params: TranslationParams): string;
}

interface CatalogEntry {
    cats: iCategories;
    loadedAt: number;
    ok: boolean;
}

const UNCATEGORIZED = '__uncategorized__';
const REGISTRATION_BATCH_SIZE = 200;

function emptyCats(): iCategories {
    return {
        [UNCATEGORIZED]: {
            __category__: UNCATEGORIZED,
            __symbol__: UNCATEGORIZED,
        } as iTranslations,
    };
}

export class LangsysServer {
    private static configuredProject: string | null = null;

    private readonly options: Required<Pick<LangsysServerOptions, 'projectid' | 'key' | 'baseLocale'>> &
        LangsysServerOptions;
    private readonly config: iLangsysConfig;
    private readonly debug: Logger;

    private catalogs = new Map<string, CatalogEntry>();
    private inflight = new Map<string, Promise<void>>();

    private keyType: 'read' | 'write' | null = null;
    private authorized: boolean | null = null;
    private authInflight: Promise<boolean> | null = null;
    private lastAuthAt = 0;

    /** Discovery queue, deduped by category + token. Only fills on write keys. */
    private missing = new Map<string, { category: string; token: string }>();
    private pendingFlush: Promise<void> | null = null;

    constructor(options: LangsysServerOptions) {
        this.options = { baseLocale: 'en', ...options };
        this.debug = new Logger(!!options.debug);

        if (LangsysServer.configuredProject && LangsysServer.configuredProject !== options.projectid) {
            this.debug.warn(
                'LangsysServer: a second instance with a different projectid reconfigures the shared API client — ' +
                    'one process serves one project.'
            );
        }
        LangsysServer.configuredProject = options.projectid;

        if (options.apiUrl) LangsysAppAPI.setBaseUrl(options.apiUrl);
        this.config = {
            projectid: options.projectid,
            key: options.key,
            sUserLocale: createSignal(this.options.baseLocale),
            baseLocale: this.options.baseLocale,
        };
        LangsysAppAPI.setup(this.config);
    }

    /**
     * Validate credentials and learn the key type. Coalesced and cached;
     * failures retry no more often than errorRetrySeconds. Translation never
     * throws on auth failure — pages degrade to source text.
     */
    private async authorize(): Promise<boolean> {
        if (this.authorized === true) return true;
        if (this.authInflight) return this.authInflight;

        const now = Date.now() / 1000;
        const retryAfter = this.options.errorRetrySeconds ?? 30;
        if (this.authorized === false && now - this.lastAuthAt < retryAfter) return false;

        this.authInflight = (async () => {
            this.lastAuthAt = Date.now() / 1000;
            const response = await LangsysAppAPI.validate(this.config);
            if (response.status && response.data) {
                const authData = response.data as { key_type?: 'read' | 'write' };
                this.keyType = authData.key_type ?? 'read';
                this.authorized = true;
                this.debug.log('LangsysServer authorized; key type:', this.keyType);
            } else {
                this.authorized = false;
                this.debug.warn('LangsysServer authorization failed', response.errors);
            }
            return this.authorized === true;
        })().finally(() => {
            this.authInflight = null;
        });
        return this.authInflight;
    }

    /**
     * Ensure a locale's catalog is loaded (fresh within catalogTtlSeconds).
     * Concurrent callers share one fetch; failures are negative-cached for
     * errorRetrySeconds so a down API never gets hammered per-request.
     */
    public async load(locale: string): Promise<void> {
        const loc = canonicalizeLocale(locale);
        const entry = this.catalogs.get(loc);
        const now = Date.now() / 1000;
        const ttl = this.options.catalogTtlSeconds ?? 300;
        const retryAfter = this.options.errorRetrySeconds ?? 30;
        if (entry && now - entry.loadedAt < (entry.ok ? ttl : retryAfter)) return;

        const running = this.inflight.get(loc);
        if (running) return running;

        const fetchPromise = (async () => {
            if (!(await this.authorize())) {
                this.catalogs.set(loc, { cats: emptyCats(), loadedAt: Date.now() / 1000, ok: false });
                return;
            }
            const response = await LangsysAppAPI.getTranslations(loc);
            if (!response.status || response.errors || !response.data) {
                this.debug.warn(`LangsysServer: catalog fetch failed for ${loc}`, response.errors);
                // Keep serving a stale catalog if we have one; otherwise negative-cache.
                const stale = this.catalogs.get(loc);
                this.catalogs.set(loc, {
                    cats: stale?.cats ?? emptyCats(),
                    loadedAt: Date.now() / 1000,
                    ok: false,
                });
                return;
            }
            const cats = response.data as iCategories;
            if (typeof cats[UNCATEGORIZED] !== 'object' || cats[UNCATEGORIZED] === null) {
                cats[UNCATEGORIZED] = {
                    __category__: UNCATEGORIZED,
                    __symbol__: UNCATEGORIZED,
                } as iTranslations;
            }
            for (const cat of Object.keys(cats)) {
                cats[cat]['__category__'] = cat;
            }
            this.catalogs.set(loc, { cats, loadedAt: Date.now() / 1000, ok: true });
            this.debug.log(`LangsysServer: catalog loaded for ${loc}`, Object.keys(cats));
        })().finally(() => {
            this.inflight.delete(loc);
        });
        this.inflight.set(loc, fetchPromise);
        return fetchPromise;
    }

    /**
     * Synchronous per-locale translation function over whatever catalog is
     * cached. Same overloads and lookup semantics as the base SDK's t():
     * miss → source-text fallback + (write keys) discovery queue; params →
     * ICU-aware interpolation in the bound locale.
     */
    public tFor(locale: string): ServerTFunction {
        const loc = canonicalizeLocale(locale);
        const fn = (phrase: string, ...rest: unknown[]): string => {
            const category = typeof rest[0] === 'string' ? rest[0] : '';
            const params = (typeof rest[0] === 'object' && rest[0] !== null ? rest[0] : rest[1]) as
                | TranslationParams
                | undefined;

            const cats = this.catalogs.get(loc)?.cats;
            const lookupCat = category || UNCATEGORIZED;
            const value = cats?.[lookupCat]?.[phrase];

            let translated: string;
            if (typeof value === 'string' && value.length > 0) {
                translated = value;
            } else {
                this.queueMissing(category, phrase);
                translated = phrase;
            }
            return params ? interpolate(translated, params, loc) : translated;
        };
        return fn as ServerTFunction;
    }

    /** Load the locale's catalog, then hand back its t(). The one-liner for request handlers. */
    public async translator(locale: string): Promise<ServerTFunction> {
        await this.load(locale);
        return this.tFor(locale);
    }

    /** Direct one-shot form: t('es-ES', 'Hello, {name}!', 'Greetings', { name }). */
    public t(locale: string, phrase: string, category?: string | TranslationParams, params?: TranslationParams): string {
        const fn = this.tFor(locale) as (...args: unknown[]) => string;
        return fn(phrase, category, params);
    }

    private queueMissing(category: string, token: string): void {
        if (this.keyType !== 'write') return;
        if (!token || token === 'toJSON') return;
        // Content-block id lookups (32-hex md5) are never registered as phrases.
        if (/^[0-9a-f]{32}$/.test(token)) return;

        const key = `${category}\u0000${token}`;
        if (this.missing.has(key)) return;
        this.missing.set(key, { category, token });
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.pendingFlush) return;
        this.pendingFlush = new Promise<void>((resolve) => {
            queueMicrotask(() => {
                void this.doFlush()
                    .catch((err) => this.debug.error('LangsysServer: registration flush failed', err))
                    .finally(() => {
                        this.pendingFlush = null;
                        resolve();
                    });
            });
        });
    }

    /**
     * Resolves when any pending phrase registration has been sent. Framework
     * adapters pass this to waitUntil()-style lifecycle hooks so registration
     * survives edge runtimes that kill the isolate after the response.
     */
    public flush(): Promise<void> {
        return this.pendingFlush ?? Promise.resolve();
    }

    private async doFlush(): Promise<void> {
        if (!this.missing.size) return;
        if (this.keyType !== 'write') {
            this.missing.clear();
            return;
        }

        // Drop anything a cached catalog already knows about.
        const toSend = [...this.missing.values()].filter(({ category, token }) => {
            const lookupCat = category || UNCATEGORIZED;
            for (const entry of this.catalogs.values()) {
                const value = entry.cats[lookupCat]?.[token];
                if (typeof value === 'string' && value.length > 0) return false;
            }
            return true;
        });
        if (!toSend.length) {
            this.missing.clear();
            return;
        }

        // Wire boundary: empty category → null ('__uncategorized__' is
        // server-internal and rejected as client input).
        const items = toSend.map(({ category, token }) => ({
            type: 'phrase',
            phrase: token,
            category: category || null,
        }));

        for (let offset = 0; offset < items.length; offset += REGISTRATION_BATCH_SIZE) {
            const response = await LangsysAppAPI.createTranslatableItems(items.slice(offset, offset + REGISTRATION_BATCH_SIZE));
            if (!response.status) {
                this.debug.warn('LangsysServer: phrase registration failed; queue kept for retry', response.errors);
                return; // Keep the queue — the next discovery re-schedules a flush.
            }
        }

        // Write the registered phrases into every cached catalog (value =
        // source text, exactly what an untranslated phrase renders) so
        // subsequent lookups don't re-queue them.
        for (const { category, token } of toSend) {
            const lookupCat = category || UNCATEGORIZED;
            for (const entry of this.catalogs.values()) {
                if (!entry.cats[lookupCat]) {
                    entry.cats[lookupCat] = {
                        __category__: lookupCat,
                        __symbol__: lookupCat,
                    } as iTranslations;
                }
                entry.cats[lookupCat][token] = token;
            }
        }
        this.debug.log(`LangsysServer: registered ${toSend.length} phrase(s)`);
        this.missing.clear();
    }

    /** Force a refetch — one locale, or every cached locale. */
    public async refresh(locale?: string): Promise<void> {
        const locales = locale ? [canonicalizeLocale(locale)] : [...this.catalogs.keys()];
        for (const loc of locales) this.catalogs.delete(loc);
        await Promise.all(locales.map((loc) => this.load(loc)));
    }

    /** Introspection for health endpoints and tests. */
    public stats(): { locales: string[]; queued: number; keyType: 'read' | 'write' | null; authorized: boolean | null } {
        return {
            locales: [...this.catalogs.keys()],
            queued: this.missing.size,
            keyType: this.keyType,
            authorized: this.authorized,
        };
    }

    /** Drop caches and the discovery queue. No timers run in this class. */
    public destroy(): void {
        this.catalogs.clear();
        this.inflight.clear();
        this.missing.clear();
    }
}
