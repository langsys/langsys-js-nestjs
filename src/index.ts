/**
 * Langsys SDK — NestJS binding
 *
 * A thin server-side wrapper over langsys-js-typescript: a locale-keyed
 * catalog cache (multi-locale safe under concurrent requests), an injectable
 * translator service, locale-detection middleware, and handler decorators.
 * Same rule as every binding: the phrase in your code is both the lookup key
 * and the base-language default.
 */

export { LangsysModule } from './langsys.module.js';
export { LangsysService } from './langsys.service.js';
export { LangsysLocaleMiddleware, type LangsysRequest } from './langsys.middleware.js';
export { Locale, T } from './decorators.js';
export { LANGSYS_OPTIONS, type LangsysModuleOptions, type LangsysModuleAsyncOptions } from './options.js';
export { LangsysServer, type LangsysServerOptions, type ServerTFunction } from './server-translator.js';
export {
    resolveLocale,
    parseAcceptLanguage,
    matchSupported,
    type LocaleResolutionConfig,
    type LocaleSources,
} from './locale.js';

// Convenience re-exports so consumers rarely need the base package directly.
export type { TranslationParams, iCategories, iTranslations } from 'langsys-js-typescript';
