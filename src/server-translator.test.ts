import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangsysServer } from './server-translator.js';

/**
 * All tests run against a mocked global fetch — the same three endpoints the
 * base SDK's LangsysAppAPI speaks: authorize-project, translations, and
 * translatable-items.
 */

interface FetchLogEntry {
    url: string;
    method: string;
    body: unknown;
}

let fetchLog: FetchLogEntry[] = [];
let keyType: 'read' | 'write' = 'read';
let authOk = true;
let translationsOk = true;

/** Per-locale catalogs served by the mock API. */
const CATALOGS: Record<string, Record<string, Record<string, string>>> = {
    'es-ES': {
        Greetings: { 'Hello, {name}!': '¡Hola, {name}!' },
        // Written flat in the source; the plural and gender branches are what Langsys generates.
        Inbox: {
            'You have {count} new messages.': 'Tienes {count, plural, one {# mensaje nuevo} other {# mensajes nuevos}}.',
        },
        Team: {
            '{username} has been invited':
                '{username_gender, select, male {{username} ha sido invitado} female {{username} ha sido invitada} other {{username} ha sido invitade}}',
        },
    },
    'fr-FR': {
        Greetings: { 'Hello, {name}!': 'Bonjour, {name}!' },
    },
};

function jsonResponse(payload: unknown, ok = true, status = 200) {
    return {
        ok,
        status,
        statusText: ok ? 'OK' : 'Server Error',
        url: 'mock',
        json: async () => payload,
    };
}

beforeEach(() => {
    fetchLog = [];
    keyType = 'read';
    authOk = true;
    translationsOk = true;

    vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(init.body) : undefined;
        fetchLog.push({ url: String(url), method, body });

        if (String(url).includes('authorize-project')) {
            return authOk
                ? jsonResponse({ status: true, data: { key_type: keyType } })
                : jsonResponse({ status: false, errors: ['bad key'] }, false, 401);
        }
        if (String(url).includes('/translations')) {
            if (!translationsOk) return jsonResponse({ status: false, errors: ['boom'] }, false, 500);
            const locale = new URL(String(url)).searchParams.get('locale') ?? '';
            // Fresh objects per response, like a real res.json() — the SDK
            // mutates catalogs in place, and sharing references across tests
            // would leak registrations between them.
            return jsonResponse({ status: true, data: structuredClone(CATALOGS[locale] ?? {}) });
        }
        if (String(url).includes('translatable-items')) {
            return jsonResponse({ status: true, data: [] });
        }
        return jsonResponse({ status: false, errors: ['unexpected route'] }, false, 404);
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function makeServer(overrides: Record<string, unknown> = {}) {
    return new LangsysServer({
        projectid: 'test-project',
        key: 'test-key',
        baseLocale: 'en-US',
        ...overrides,
    });
}

describe('multi-locale catalog cache', () => {
    it('serves different locales concurrently without racing', async () => {
        const server = makeServer();
        const [tEs, tFr] = await Promise.all([server.translator('es-ES'), server.translator('fr-FR')]);

        expect(tEs('Hello, {name}!', 'Greetings', { name: 'Sara' })).toBe('¡Hola, Sara!');
        expect(tFr('Hello, {name}!', 'Greetings', { name: 'Sara' })).toBe('Bonjour, Sara!');
        // And the first locale's function still answers correctly afterwards.
        expect(tEs('Hello, {name}!', 'Greetings', { name: 'Sara' })).toBe('¡Hola, Sara!');
    });

    it('coalesces concurrent loads of the same locale into one fetch', async () => {
        const server = makeServer();
        await Promise.all([server.load('es-ES'), server.load('es-ES'), server.load('es-ES')]);
        const translationFetches = fetchLog.filter((e) => e.url.includes('/translations'));
        expect(translationFetches).toHaveLength(1);
    });

    it('serves a fresh catalog from cache without refetching', async () => {
        const server = makeServer();
        await server.load('es-ES');
        await server.load('es-ES');
        expect(fetchLog.filter((e) => e.url.includes('/translations'))).toHaveLength(1);
    });

    it('resolves ICU plurals in the bound locale', async () => {
        const server = makeServer();
        const t = await server.translator('es-ES');
        const phrase = 'You have {count} new messages.';
        expect(t(phrase, 'Inbox', { count: 1 })).toBe('Tienes 1 mensaje nuevo.');
        expect(t(phrase, 'Inbox', { count: 3 })).toBe('Tienes 3 mensajes nuevos.');
    });

    it('resolves the gender branch Langsys adds, and takes "other" when the argument is missing', async () => {
        const server = makeServer();
        const t = await server.translator('es-ES');
        expect(t('{username} has been invited', 'Team', { username: 'Sarah', username_gender: 'female' })).toBe('Sarah ha sido invitada');
        // The app never wrote a gender argument: the locale grew one. Missing, it must read
        // as the neutral branch, never as raw ICU (langsys-js-typescript 0.6.4).
        expect(t('{username} has been invited', 'Team', { username: 'Sarah' })).toBe('Sarah ha sido invitade');
    });
});

describe('fallback behavior', () => {
    it('renders source text for unknown phrases', async () => {
        const server = makeServer();
        const t = await server.translator('es-ES');
        expect(t('Never registered', 'Nowhere')).toBe('Never registered');
    });

    it('interpolates params into the source-text fallback', async () => {
        const server = makeServer();
        const t = await server.translator('es-ES');
        expect(t('Hi {name}', 'Nowhere', { name: 'Ana' })).toBe('Hi Ana');
    });

    it('degrades to source text when authorization fails, without throwing', async () => {
        authOk = false;
        const server = makeServer();
        const t = await server.translator('es-ES');
        expect(t('Hello, {name}!', 'Greetings', { name: 'Sara' })).toBe('Hello, Sara!');
    });

    it('degrades to source text when the catalog fetch fails, and negative-caches the failure', async () => {
        translationsOk = false;
        const server = makeServer({ errorRetrySeconds: 60 });
        const t1 = await server.translator('es-ES');
        expect(t1('Hello, {name}!', 'Greetings', { name: 'Sara' })).toBe('Hello, Sara!');

        const fetchesBefore = fetchLog.filter((e) => e.url.includes('/translations')).length;
        await server.translator('es-ES');
        const fetchesAfter = fetchLog.filter((e) => e.url.includes('/translations')).length;
        expect(fetchesAfter).toBe(fetchesBefore); // within the retry window: no hammering
    });
});

describe('phrase discovery', () => {
    it('never registers on a read-only key', async () => {
        keyType = 'read';
        const server = makeServer();
        const t = await server.translator('es-ES');
        t('Brand new phrase', 'Checkout');
        await server.flush();
        expect(fetchLog.filter((e) => e.url.includes('translatable-items'))).toHaveLength(0);
    });

    it('registers misses on a write key with the wire shape (empty category → null)', async () => {
        keyType = 'write';
        const server = makeServer();
        const t = await server.translator('es-ES');
        t('Brand new phrase', 'Checkout');
        t('Uncategorized phrase');
        await server.flush();

        const posts = fetchLog.filter((e) => e.url.includes('translatable-items'));
        expect(posts).toHaveLength(1);
        const body = posts[0].body as { project_id: string; translatable_items: unknown[] };
        expect(body.project_id).toBe('test-project');
        expect(body.translatable_items).toEqual([
            { type: 'phrase', phrase: 'Brand new phrase', category: 'Checkout' },
            { type: 'phrase', phrase: 'Uncategorized phrase', category: null },
        ]);
    });

    it('does not re-register a phrase after a successful flush', async () => {
        keyType = 'write';
        const server = makeServer();
        const t = await server.translator('es-ES');
        t('Brand new phrase', 'Checkout');
        await server.flush();
        t('Brand new phrase', 'Checkout'); // hit again — now in the cached catalog
        await server.flush();
        expect(fetchLog.filter((e) => e.url.includes('translatable-items'))).toHaveLength(1);
    });

    it('skips content-block md5 ids and empty tokens', async () => {
        keyType = 'write';
        const server = makeServer();
        const t = await server.translator('es-ES');
        t('d41d8cd98f00b204e9800998ecf8427e', 'Blocks');
        t('', 'Blocks');
        await server.flush();
        expect(fetchLog.filter((e) => e.url.includes('translatable-items'))).toHaveLength(0);
    });
});

describe('refresh and stats', () => {
    it('refresh forces a refetch', async () => {
        const server = makeServer();
        await server.load('es-ES');
        await server.refresh('es-ES');
        expect(fetchLog.filter((e) => e.url.includes('/translations'))).toHaveLength(2);
    });

    it('stats reports cached locales and key type', async () => {
        keyType = 'write';
        const server = makeServer();
        await server.load('es-ES');
        const stats = server.stats();
        expect(stats.locales).toContain('es-ES');
        expect(stats.keyType).toBe('write');
        expect(stats.authorized).toBe(true);
    });
});
