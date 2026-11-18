// The Mac's MatcherTests and QuickTimerParseTests, ported.

import {test, assertEqual} from '../harness.js';
import {match, parseQuickTimer} from '../../lib/core/matcher.js';

const action = (id, title, subtitle, kind, keywords) => ({id, title, subtitle, kind, glyph: 'plus', keywords, suggest: 'never', run: () => {}});

/** A catalogue shaped like the spec's, with a local model, a service and an ssh command. */
const catalogue = () => [
    action('focus.start:25', 'Start 25 min focus', 'pomodoro · focus session', 'focus', 'pomodoro focus timer work start'),
    action('focus.start:40', 'Start 40 min focus', 'pomodoro · focus session', 'focus', 'pomodoro focus timer work start'),
    action('focus.start:50', 'Start 50 min focus', 'pomodoro · focus session', 'focus', 'pomodoro focus timer work start'),
    action('focus.break', 'Take a break now', 'pomodoro · break options', 'focus', 'pomodoro break rest'),
    action('caffeine.on:60', 'Keep awake for 1 hour', 'caffeine · prevent sleep', 'caffeine', 'caffeine awake sleep screensaver on'),
    action('caffeine.on:120', 'Keep awake for 2 hours', 'caffeine · prevent sleep', 'caffeine', 'caffeine awake sleep screensaver on'),
    action('caffeine.on', 'Keep awake until turned off', 'caffeine · prevent sleep', 'caffeine', 'caffeine awake sleep screensaver on'),
    action('model.use:1', 'Switch model to Llama 3.1 8B', 'Ollama · llama3.1:8b', 'model', 'model switch llm use ollama'),
    action('service.start:1', 'Start Postgres', 'postgres -D ./data · ~/db', 'service', 'service server run start launch'),
    action('command.run:1', 'Run Deploy', 'ssh deploy@prod ./deploy.sh', 'command', 'command terminal shell run ssh deploy@prod ./deploy.sh'),
    action('chat.pinned', 'Pinned chats', '3 saved', 'chat', 'pinned saved history chats'),
    action('chat.new', 'New chat', 'clear the current conversation', 'chat', 'new chat clear reset'),
    action('theme.toggle', 'Toggle theme', 'appearance · Dark → Light', 'action', 'theme dark light appearance'),
    ...['chat', 'focus', 'caffeine', 'services', 'commands'].map((tab, i) =>
        action(`view.open:${tab}`, `Go to ${tab[0].toUpperCase()}${tab.slice(1)}`, `view · Ctrl+${i + 1}`, 'view', `open view go ${tab}`)),
];

const llama = {ask: {model: 'Llama 3.1 8B'}, inConversation: false};
const titles = rows => rows.map(r => (r.kind === 'action' ? r.action.title : r.kind === 'ask' ? r.title : r.text));

test('"focus" shows Ask first, then five actions', () => {
    const rows = match('focus', catalogue(), llama);
    assertEqual(titles(rows), ['Ask Llama 3.1 8B', 'Start 25 min focus', 'Start 40 min focus', 'Start 50 min focus', 'Take a break now', 'Go to Focus']);
    assertEqual(rows[0], {kind: 'ask', title: 'Ask Llama 3.1 8B', subtitle: '“focus”'});
});

test('words find a model through its provider, a command through its command line', () => {
    assertEqual(titles(match('llama', catalogue(), llama)), ['Ask Llama 3.1 8B', 'Switch model to Llama 3.1 8B']);
    assertEqual(titles(match('ssh', catalogue(), llama)), ['Ask Llama 3.1 8B', 'Run Deploy']);
});

test('a slash alone lists the first nine actions, with no Ask row; a slash filters', () => {
    assertEqual(titles(match('/', catalogue(), llama)), catalogue().slice(0, 9).map(a => a.title));
    assertEqual(titles(match('/awake', catalogue(), llama)), ['Keep awake for 1 hour', 'Keep awake for 2 hours', 'Keep awake until turned off']);
});

test('a slash typo shows No matching actions, then the Ask row', () => {
    assertEqual(match('/fcous', catalogue(), llama), [{kind: 'noMatch', text: 'No matching actions'}, {kind: 'ask', title: 'Ask Llama 3.1 8B', subtitle: '“/fcous”'}]);
});

test('a typed timer is placed as given; a bad one says why; words still filter', () => {
    const row = action('focus.start:any:35', 'Start 35 min focus', 'focus · ends 15:42', 'focus', '');
    assertEqual(match('/start 35', catalogue(), {...llama, typed: {timer: {kind: 'focus', minutes: 35}, action: row}}), [{kind: 'action', action: row}]);
    assertEqual(titles(match('/start 0', catalogue(), {...llama, typed: {timer: parseQuickTimer('/start 0'), action: null}})),
        ['A focus can be 1 to 180 minutes', 'Ask Llama 3.1 8B']);
    assertEqual(titles(match('/start foc', catalogue(), {...llama, typed: {timer: parseQuickTimer('/start foc'), action: null}}))[0], 'Start 25 min focus');
});

test('every word must match; the kind label is searched; case and spaces don\'t matter', () => {
    assertEqual(titles(match('start 50', catalogue(), llama)), ['Ask Llama 3.1 8B', 'Start 50 min focus']);
    assertEqual(titles(match('/service', [action('service.start:2', 'Start Redis', 'redis-server', 'service', '')], llama)), ['Start Redis']);
    assertEqual(match('  KILL  ', catalogue(), llama), [{kind: 'ask', title: 'Ask Llama 3.1 8B', subtitle: '“KILL”'}]);
});

test('one character shows only the Ask row; empty input shows nothing', () => {
    assertEqual(titles(match('f', catalogue(), llama)), ['Ask Llama 3.1 8B']);
    assertEqual(match('   ', catalogue(), llama), []);
});

test('in a conversation, rows show only when actions match', () => {
    const talk = {...llama, inConversation: true};
    assertEqual([match('f', catalogue(), talk), match('thanks a lot', catalogue(), talk)], [[], []]);
    const rows = match('pomodoro', catalogue(), talk);
    assertEqual([titles(rows)[0], rows.length], ['Ask Llama 3.1 8B', 5]);
});

test('the Ask row quotes at most 60 characters; with no model it sets one up', () => {
    assertEqual(match('a'.repeat(70), [], llama), [{kind: 'ask', title: 'Ask Llama 3.1 8B', subtitle: `“${'a'.repeat(60)}…”`}]);
    assertEqual(match('hello', [], {ask: null, inConversation: false}), [{kind: 'ask', title: 'Set up a model to chat', subtitle: 'Preferences → Chat'}]);
});

// /start and /break.

test('a valid command gives its length', () => {
    const cases = [
        ['/start 35', 'focus', 35], ['/start 35m', 'focus', 35], ['/start 35 m', 'focus', 35], ['/start 35min', 'focus', 35],
        ['/start 35 min', 'focus', 35], ['/START 35 MIN', 'focus', 35], ['/break 5', 'break', 5], ['/break 5m', 'break', 5],
        ['/break 5 min', 'break', 5], ['/start 007', 'focus', 7],
    ];
    for (const [input, kind, minutes] of cases)
        assertEqual(parseQuickTimer(input), {kind, minutes}, input);
});

test('the bounds: a focus 1–180 minutes, a break 1–60, huge numbers out of range', () => {
    const out = kind => ({kind: 'invalid', of: kind, reason: 'outOfRange', text: kind === 'focus' ? 'A focus can be 1 to 180 minutes' : 'A break can be 1 to 60 minutes'});
    assertEqual(parseQuickTimer('/start 0'), out('focus'));
    assertEqual(parseQuickTimer('/start 1'), {kind: 'focus', minutes: 1});
    assertEqual(parseQuickTimer('/start 180'), {kind: 'focus', minutes: 180});
    assertEqual(parseQuickTimer('/start 181'), out('focus'));
    assertEqual(parseQuickTimer('/break 0'), out('break'));
    assertEqual(parseQuickTimer('/break 60'), {kind: 'break', minutes: 60});
    assertEqual(parseQuickTimer('/break 61'), out('break'));
    assertEqual(parseQuickTimer('/start 99999999999999999999'), out('focus'));
});

test('anything else asks for the minutes; other input isn\'t a timer', () => {
    for (const [input, kind] of [['/start abc', 'focus'], ['/start 3.5', 'focus'], ['/start -5', 'focus'], ['/start 35x', 'focus'],
        ['/start 35 minutes', 'focus'], ['/break five', 'break'], ['/break 5 h', 'break']]) {
        assertEqual(parseQuickTimer(input), {kind: 'invalid', of: kind, reason: 'notANumber',
            text: `Type the minutes, like ${kind === 'focus' ? '/start 35' : '/break 5'}`}, input);
    }
    for (const input of ['/start', '/break', '/starts 5', 'start 35', '/stop 5', '/focus 35', '35', '/'])
        assertEqual(parseQuickTimer(input), null, input);
});

test('before the chat (ask undefined), no Ask row: only actions, or No matching actions', () => {
    const none = {ask: undefined, inConversation: false};
    assertEqual(titles(match('focus', catalogue(), none)).slice(0, 2), ['Start 25 min focus', 'Start 40 min focus']);
    assertEqual(match('focus', catalogue(), none).length, 5);
    assertEqual(match('hello there', catalogue(), none), []);
    assertEqual(match('f', catalogue(), none), []);
    assertEqual(match('/fcous', catalogue(), none), [{kind: 'noMatch', text: 'No matching actions'}]);
});
