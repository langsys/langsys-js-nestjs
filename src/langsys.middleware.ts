import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { LangsysService } from './langsys.service.js';
import type { ServerTFunction } from './server-translator.js';

/**
 * Structural request/response shapes instead of Express types: the middleware
 * only touches fields both Express and Fastify's raw objects provide, so it
 * works under either Nest HTTP adapter without dragging platform types in.
 */
export interface LangsysRequest {
    url?: string;
    originalUrl?: string;
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, unknown>;
    /** Set by the middleware. */
    langsysLocale?: string;
    /** Set by the middleware. */
    t?: ServerTFunction;
}

interface ResponseLike {
    setHeader?: (name: string, value: string | string[]) => unknown;
    getHeader?: (name: string) => unknown;
}

function firstHeader(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function readCookie(header: string | null, name: string): string | null {
    if (!header || !name) return null;
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
}

/**
 * Resolves the visitor's locale (?locale → cookie → Accept-Language →
 * default), persists explicit choices in a cookie, loads that locale's
 * catalog, and attaches `req.langsysLocale` + `req.t` for everything
 * downstream. Apply it app-wide:
 *
 *   export class AppModule implements NestModule {
 *       configure(consumer: MiddlewareConsumer) {
 *           consumer.apply(LangsysLocaleMiddleware).forRoutes('*');
 *       }
 *   }
 */
@Injectable()
export class LangsysLocaleMiddleware implements NestMiddleware {
    constructor(@Inject(LangsysService) private readonly langsys: LangsysService) {}

    async use(req: LangsysRequest, res: ResponseLike, next: (error?: unknown) => void): Promise<void> {
        try {
            const url = req.originalUrl ?? req.url ?? '/';
            const queryFromUrl = /[?&]/.test(url) ? new URL(url, 'http://internal').searchParams : null;
            const rawQuery =
                (req.query?.[this.langsys.queryParam] as string | undefined) ??
                queryFromUrl?.get(this.langsys.queryParam) ??
                null;

            const cookieName = this.langsys.cookieName;
            const locale = this.langsys.resolveLocale({
                query: rawQuery,
                cookie: readCookie(firstHeader(req.headers['cookie']), cookieName),
                acceptLanguage: firstHeader(req.headers['accept-language']),
            });

            // Persist an explicit switch so it survives navigation without the param.
            if (rawQuery && cookieName && res.setHeader) {
                const cookie = `${cookieName}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
                const existing = res.getHeader?.('Set-Cookie');
                const value = Array.isArray(existing)
                    ? [...(existing as string[]), cookie]
                    : typeof existing === 'string'
                      ? [existing, cookie]
                      : cookie;
                res.setHeader('Set-Cookie', value);
            }

            req.langsysLocale = locale;
            req.t = await this.langsys.translator(locale);
            next();
        } catch (error) {
            // Translation must never take the page down: fall back to
            // source-text rendering and keep the request moving.
            req.langsysLocale ??= this.langsys.resolveLocale({});
            req.t ??= this.langsys.tFor(req.langsysLocale);
            next();
            void error;
        }
    }
}
