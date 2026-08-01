import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2021',
    treeshake: true,
    splitting: false,
    minify: false,
    // Nest is provided by the consuming app — never bundle it. Note: esbuild
    // does not emit decorator metadata, which is why every injection point in
    // this package uses explicit @Inject() tokens instead of relying on
    // design:paramtypes.
    external: ['@nestjs/common', 'reflect-metadata', 'rxjs'],
});
