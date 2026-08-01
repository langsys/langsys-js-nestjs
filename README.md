# langsys-js-nestjs

NestJS binding for the [Langsys](https://langsys.dev) translation SDK — realtime continuous translations with automatic token discovery, for multi-locale Node servers.

A thin server-side wrapper over [`langsys-js-typescript`](https://github.com/langsys/langsys-js-typescript). Same rule as every Langsys binding: **the phrase in your code is both the lookup key and the base-language default** — no keys file, no extraction step. Unlike the browser bindings, this one keeps a **locale-keyed catalog cache**, so concurrent requests in different locales never race.

## Install

```sh
npm install langsys-js-nestjs
```

## Setup

```ts
// app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LangsysModule, LangsysLocaleMiddleware } from 'langsys-js-nestjs';

@Module({
    imports: [
        LangsysModule.forRoot({
            projectid: process.env.LANGSYS_PROJECT_ID!,
            key: process.env.LANGSYS_API_KEY!, // write key — server-side only
            baseLocale: 'en-US',
            supportedLocales: ['en-US', 'es-ES', 'fr-FR', 'de-DE'],
        }),
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(LangsysLocaleMiddleware).forRoutes('*');
    }
}
```

The middleware resolves the visitor's locale (`?locale` → cookie → `Accept-Language` → default), persists explicit switches in a cookie, loads that locale's catalog, and attaches `req.langsysLocale` + `req.t`.

## Translate

```ts
import { Controller, Get } from '@nestjs/common';
import { T, Locale, type ServerTFunction } from 'langsys-js-nestjs';

@Controller()
export class AppController {
    @Get()
    home(@T() t: ServerTFunction, @Locale() locale: string) {
        return `<h1>${t('Welcome to our store', 'Home')}</h1>
                <p>${t('Hello, {name}!', 'Greetings', { name: 'Sara' })}</p>`;
    }
}
```

Or inject the service anywhere — jobs, mailers, gateways:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { LangsysService } from 'langsys-js-nestjs';

@Injectable()
export class DigestJob {
    constructor(@Inject(LangsysService) private readonly langsys: LangsysService) {}

    async send(locale: string) {
        const t = await this.langsys.translator(locale);
        return t('Your weekly digest', 'Emails');
    }
}
```

ICU plurals work the same as every Langsys SDK:

```ts
t('You have {count, plural, one {# new message} other {# new messages}}.', 'Inbox', { count: 3 });
```

## How it behaves

- **Multi-locale safe.** One catalog per locale, cached with a TTL (default 300s) and a stampede guard. Concurrent requests in different locales each get their own `t()`.
- **Fails soft.** Bad credentials, an unreachable API, a cold catalog — pages render source text; nothing throws in the request path.
- **Token discovery on write keys.** A phrase `t()` has never seen is registered with your project after the current microtask (batched); with a read-only key the queue is skipped entirely.
- **`forRootAsync`** is available for config-module-driven setups.

## Notes

- The underlying API client is process-global: one Nest process serves one Langsys project.
- Built without decorator metadata (esbuild) — all internal injection uses explicit tokens, so it works regardless of your app's `emitDecoratorMetadata` setting.

## License

MIT © Flexark International Ltda.
