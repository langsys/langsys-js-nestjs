import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { LangsysRequest } from './langsys.middleware.js';

/**
 * Handler parameter decorators reading what LangsysLocaleMiddleware attached:
 *
 *   @Get()
 *   home(@T() t: ServerTFunction, @Locale() locale: string) {
 *       return `<h1>${t('Welcome to our store', 'Home')}</h1>`;
 *   }
 */
export const Locale = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest<LangsysRequest>().langsysLocale;
});

export const T = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<LangsysRequest>().t;
});
