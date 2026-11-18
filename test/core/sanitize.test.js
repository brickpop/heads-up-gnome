import {test, assertEqual} from '../harness.js';
import {redactSecrets} from '../../lib/core/sanitize.js';

test('redactSecrets masks headers, bearer tokens, sk- keys and known tokens', () => {
    assertEqual(redactSecrets('Authorization: Bearer abc.def-123'), 'Authorization: Bearer ••••');
    assertEqual(redactSecrets('{"authorization":"xyz123"}'), '{"authorization":"••••"}');
    assertEqual(redactSecrets('got bearer abcd1234 back'), 'got bearer •••• back');
    assertEqual(redactSecrets('key sk-proj_ABCDEF1234 bad'), 'key •••• bad');
    assertEqual(redactSecrets('token=hunter22 x', ['hunter22']), 'token=•••• x');
    assertEqual(redactSecrets('plain text', ['ab']), 'plain text');
});

test('redactSecrets masks keys in URL queries and key headers (Scan S0-3)', () => {
    const cases = [
        ['GET https://g.example/v1?key=abc123&alt=sse', 'GET https://g.example/v1?key=••••&alt=sse'],
        ['https://x.example/?api_key=abc123', 'https://x.example/?api_key=••••'],
        ['https://x.example/?a=1&API-KEY=abc123#f', 'https://x.example/?a=1&API-KEY=••••#f'],
        ['https://x.example/?apikey=abc123', 'https://x.example/?apikey=••••'],
        ['https://x.example/?token=abc123', 'https://x.example/?token=••••'],
        ['https://x.example/?access_token=abc123 next', 'https://x.example/?access_token=•••• next'],
        ['https://x.example/?auth=abc123', 'https://x.example/?auth=••••'],
        ['x-api-key: abc123', 'x-api-key: ••••'],
        ['{"api-key": "abc123"}', '{"api-key": "••••"}'],
        ['key AIzaSyA1234567890abcdefghijk end', 'key •••• end'],
        ['https://x.example/?monkey=fine&tokens=fine', 'https://x.example/?monkey=fine&tokens=fine'],
    ];
    for (const [text, expected] of cases)
        assertEqual(redactSecrets(text), expected, text);
});
