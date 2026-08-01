import type { ModuleMetadata } from '@nestjs/common';
import type { LangsysServerOptions } from './server-translator.js';

/**
 * Injection token for the module options. A string token on purpose: this
 * package is built with esbuild (no decorator metadata), so every injection
 * point names its token explicitly.
 */
export const LANGSYS_OPTIONS = 'LANGSYS_OPTIONS';

export interface LangsysModuleOptions extends LangsysServerOptions {
    /** Locale served when nothing on the request matches. Defaults to baseLocale. */
    defaultLocale?: string;
    /** Locales the app serves; request locales are matched against it (exact, then language prefix). */
    supportedLocales?: string[];
    /** Query parameter carrying an explicit locale choice. Default 'locale'. */
    queryParam?: string;
    /** Cookie persisting the visitor's choice. Default 'langsys_locale'; empty string disables persistence. */
    cookieName?: string;
}

export interface LangsysModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
    inject?: Array<string | symbol | (abstract new (...args: never[]) => unknown)>;
    useFactory: (...args: never[]) => Promise<LangsysModuleOptions> | LangsysModuleOptions;
}
