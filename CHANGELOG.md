# Changelog

## 0.1.0

Initial release.

- `LangsysModule.forRoot` / `forRootAsync` — global module configuration.
- `LangsysServer` — multi-locale, locale-keyed catalog cache over the base SDK's API client: TTL + stampede guard, negative caching on failure, per-locale `t()` with the base SDK's lookup semantics and ICU interpolation.
- `LangsysService` — injectable translator facade (`translator(locale)`, `t(locale, …)`, `refresh`, `flush`).
- `LangsysLocaleMiddleware` — query → cookie → `Accept-Language` → default locale resolution with cookie persistence; attaches `req.langsysLocale` and `req.t`.
- `@T()` / `@Locale()` handler parameter decorators.
- Phrase discovery on write keys, batched via `translatable-items`; read-only keys never register.
