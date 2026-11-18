import {test, assertEqual} from '../harness.js';
import {formatLine} from '../../lib/adapters/log.js';

test('a code and fixed fields, secrets redacted, strings cut', () => {
    assertEqual(formatLine('shortcut.record-damaged'), 'HeadsUp: shortcut.record-damaged');
    assertEqual(formatLine('http.failed', {status: 401, retry: false, detail: 'Authorization: Bearer abcdef'}),
        'HeadsUp: http.failed status=401 retry=false detail="Authorization: Bearer ••••"');
    assertEqual(formatLine('x', {long: 'a'.repeat(500)}).length < 200, true);
});

test('a code or field name that is not a code is not printed as given', () => {
    assertEqual(formatLine('Some text\nfrom a model'), 'HeadsUp: log.bad-code');
    assertEqual(formatLine('ok', {'bad key\n': 1}), 'HeadsUp: ok');
});
