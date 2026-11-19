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

test('stripControls: ANSI sequences, controls but tab and newline, and bidi go (Scan S3P-1)', async () => {
    const {stripControls} = await import('../../lib/core/sanitize.js');
    assertEqual(stripControls('\u001B[31mred\u001B[0m ok'), 'red ok');
    assertEqual(stripControls('a‮b\u0000c\td\ne\u0085f⁦g'), 'abc\td\nefg');
    assertEqual(stripControls('\u001B]0;title\u0007after \u001B]8;;http://x\u001B\\link'), 'after link');
    assertEqual(stripControls('end\u001B'), 'end');
});

test('cutTail keeps the end within the limit, from a line start, never mid-character', async () => {
    const {TEXT_LIMIT, cutTail} = await import('../../lib/core/sanitize.js');
    assertEqual(TEXT_LIMIT, 64 * 1024);
    assertEqual(cutTail('short'), {text: 'short', cut: false});
    assertEqual(cutTail('aaaa\nbbbb\ncccc', 9), {text: 'bbbb\ncccc', cut: true});
    assertEqual(cutTail('aaaa\nbbbb\ncccc', 8), {text: 'cccc', cut: true});
    assertEqual(cutTail('ab\n€€\nzz', 9), {text: '€€\nzz', cut: true});
    assertEqual(cutTail('ab\n€€\nzz', 8), {text: 'zz', cut: true});
    const big = Array.from({length: 2000}, (_, i) => `line ${i} ${'x'.repeat(50)}`).join('\n');
    const {text, cut} = cutTail(big);
    assertEqual([cut, new TextEncoder().encode(text).length <= TEXT_LIMIT, text.startsWith('line '), text.endsWith('line 1999 ' + 'x'.repeat(50))], [true, true, true, true]);
});

test('an escape sequence never crosses a line (Scan): the line feed stays', async () => {
    const {stripControls} = await import('../../lib/core/sanitize.js');
    assertEqual(stripControls('a\u001B]0;x\nb\n').split('\n'), ['a', 'b', '']);
    assertEqual(stripControls('a\u001B[12\nb'), 'a\nb');
    const {LogRing} = await import('../../lib/core/logRing.js');
    const ring = new LogRing();
    ring.appendOutput(new TextEncoder().encode('a\u001B]0;x\nb\n'), 0);
    assertEqual(ring.lines.map(l => l.text), ['a', 'b']);
});

test('showControls makes every control visible, never runs or hides it (F1)', async () => {
    const {showControls} = await import('../../lib/core/sanitize.js');
    assertEqual(showControls('rm -rf \u202E/ \u001B[2Jok\ttab'), 'rm -rf ⟨U+202E⟩/ ⟨ESC⟩[2Jok⟨U+0009⟩tab');
    assertEqual(showControls('npm run dev'), 'npm run dev');
});
