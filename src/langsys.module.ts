import { Module, type DynamicModule } from '@nestjs/common';
import { LangsysService } from './langsys.service.js';
import { LangsysLocaleMiddleware } from './langsys.middleware.js';
import { LANGSYS_OPTIONS, type LangsysModuleAsyncOptions, type LangsysModuleOptions } from './options.js';

/**
 * Global module — import once in AppModule:
 *
 *   LangsysModule.forRoot({
 *       projectid: process.env.LANGSYS_PROJECT_ID!,
 *       key: process.env.LANGSYS_API_KEY!, // write key: server-side only
 *       baseLocale: 'en-US',
 *       supportedLocales: ['en-US', 'es-ES', 'fr-FR', 'de-DE'],
 *   })
 *
 * then apply LangsysLocaleMiddleware app-wide (see its docblock) and inject
 * LangsysService — or use the @T() / @Locale() handler decorators.
 */
@Module({})
export class LangsysModule {
    static forRoot(options: LangsysModuleOptions): DynamicModule {
        return {
            module: LangsysModule,
            global: true,
            providers: [{ provide: LANGSYS_OPTIONS, useValue: options }, LangsysService, LangsysLocaleMiddleware],
            exports: [LangsysService, LangsysLocaleMiddleware],
        };
    }

    static forRootAsync(options: LangsysModuleAsyncOptions): DynamicModule {
        return {
            module: LangsysModule,
            global: true,
            imports: options.imports ?? [],
            providers: [
                {
                    provide: LANGSYS_OPTIONS,
                    useFactory: options.useFactory,
                    inject: options.inject ?? [],
                },
                LangsysService,
                LangsysLocaleMiddleware,
            ],
            exports: [LangsysService, LangsysLocaleMiddleware],
        };
    }
}
