// The catalogue with the Focus and view sections (the Mac's FocusStoreTests actions part,
// FocusHideAfterStartTests' typed starts).

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {ActionRegistry} from '../../lib/core/actions.js';

const start = () => {
    const ports = testPorts({state: {'welcome-done': true}});
    return {ports, app: createApp(ports)};
};
const find = (app, id) => app.actions.actions.find(a => a.id === id);

test('sections keep the catalogue order, whatever order providers come in', () => {
    const registry = new ActionRegistry();
    registry.add('view', () => [{id: 'v'}]);
    registry.add('focus', () => [{id: 'f1'}]);
    registry.add('focus', () => [{id: 'f2'}]);
    assertEqual(registry.actions.map(a => a.id), ['f1', 'f2', 'v']);
});

test('the Stop action shows only while a timer runs', () => {
    const {app} = start();
    assertEqual(find(app, 'focus.stop'), undefined);
    app.focus.start();
    const stop = find(app, 'focus.stop');
    assertEqual(stop.subtitle, 'pomodoro · focus');
    stop.run();
    assertEqual(app.focus.phase.kind, 'idle');
    app.dispose();
});

test('a Start action starts, goes to Focus, and hides the HUD after a moment', () => {
    const {ports, app} = start();
    app.hud.focus('chat');
    find(app, 'focus.start:50').run();
    assertEqual([app.focus.phase.run.minutes, app.hud.state.tab, app.hud.state.visible], [50, 'focus', true]);
    ports.clock.advance(1500);
    assertEqual(app.hud.state.visible, false);
    app.dispose();
});

test('Go to <tab> and Take a break now', () => {
    const {app} = start();
    const go = find(app, 'view.open:services');
    assertEqual([go.title, go.subtitle], ['Go to Services', 'view · Ctrl+4']);
    go.run();
    assertEqual(app.hud.state.tab, 'services');
    find(app, 'focus.break').run();
    assertEqual([app.hud.state.tab, app.focus.phase.prompt.manual], ['focus', true]);
    app.dispose();
});

test('a typed /start 30 starts from the row, goes to Focus and hides the HUD', () => {
    const {ports, app} = start();
    app.hud.focus('chat');
    const rows = app.actions.match('/start 30', {ask: null, inConversation: false});
    assertEqual(rows.length, 1);
    assertEqual([rows[0].action.title, rows[0].action.suggest], ['Start 30 min focus', 'never']);
    assertEqual(rows[0].action.subtitle.startsWith('focus · ends '), true);
    rows[0].action.run();
    assertEqual([app.focus.phase.run.minutes, app.hud.state.tab], [30, 'focus']);
    ports.clock.advance(1500);
    assertEqual(app.hud.state.visible, false);
    app.dispose();
});

test('while a timer runs, the typed row says what it replaces', () => {
    const {ports, app} = start();
    app.focus.start();
    ports.clock.advance(13 * 60_000 + 1000);
    const [row] = app.actions.match('/break 7', {ask: null, inConversation: false});
    assertEqual([row.action.title, row.action.subtitle], ['Take a 7 min break', 'replaces your focus · 12 min left']);
    row.action.run();
    assertEqual([app.focus.phase.kind, app.focus.phase.run.minutes], ['rest', 7]);
    app.dispose();
});
