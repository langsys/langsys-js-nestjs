import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { LangsysServer, type ServerTFunction } from './server-translator.js';
import { resolveLocale, type LocaleSources } from './locale.js';
import { LANGSYS_OPTIONS, type LangsysModuleOptions } from './options.js';
import type { TranslationParams } from 'langsys-js-typescript';

/**
 * The injectable translation seam. Singleton-scoped on purpose: the catalog
 * cache is shared across requests, and every method takes (or resolves) the
 * request's locale explicitly, so concurrent requests in different locales
 * never race.
 */
@Injectable()
export class LangsysService implements OnModuleDestroy {
    public readonly server: LangsysServer;

    constructor(@Inject(LANGSYS_OPTIONS) private readonly options: LangsysModuleOptions) {
        this.server = new LangsysServer(options);
    }

    /** Load the locale's catalog and return its t() — the handler one-liner. */
    translator(locale: string): Promise<ServerTFunction> {
        return this.server.translator(locale);
    }

    /** Synchronous t() over whatever catalog is already cached for the locale. */
    tFor(locale: string): ServerTFunction {
        return this.server.tFor(locale);
    }

    /** One-shot: t('es-ES', 'Hello, {name}!', 'Greetings', { name }). */
    t(locale: string, phrase: string, category?: string | TranslationParams, params?: TranslationParams): string {
        return this.server.t(locale, phrase, category, params);
    }

    /** Resolve the request locale with the module's defaults (query → cookie → Accept-Language). */
    resolveLocale(sources: LocaleSources): string {
        return resolveLocale(sources, {
            defaultLocale: this.options.defaultLocale ?? this.options.baseLocale ?? 'en',
            supportedLocales: this.options.supportedLocales,
        });
    }

    /** Query parameter used for explicit locale switches. */
    get queryParam(): string {
        return this.options.queryParam ?? 'locale';
    }

    /** Cookie persisting the visitor's choice; empty string means persistence is disabled. */
    get cookieName(): string {
        return this.options.cookieName ?? 'langsys_locale';
    }

    /** Await any pending phrase registration (useful in tests and graceful shutdown). */
    flush(): Promise<void> {
        return this.server.flush();
    }

    /** Force a catalog refetch — one locale, or all cached. */
    refresh(locale?: string): Promise<void> {
        return this.server.refresh(locale);
    }

    onModuleDestroy(): void {
        this.server.destroy();
    }
}
