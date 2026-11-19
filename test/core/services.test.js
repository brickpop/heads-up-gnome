// ServiceStore: the Mac's ServiceStoreTests, ServiceRestartTests, ServicePortTests,
// ServicesScreenTests and ServiceDeleteTests (their GNOME parts: no services.json, no process
// groups or SIGKILL of our own, no shell environment read), plus N4b.

import {test, assertEqual, settle, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {MAX_RESTARTS, deleteService, saveService} from '../../lib/core/services.js';
import {draftChanged, draftOf, readDefinition} from '../../lib/core/serviceDefinition.js';

const ID = '0b6c3a52-6f43-4bb5-9f11-2f0f3d7c9a10';
const ID2 = '1c7d4b63-7054-4cc6-8a22-3a1e4e8dab21';

const service = (fields = {}) => ({
    'id': ID, 'name': 'Web dev server', 'command': 'npm run dev', 'cwd': '~/code/web', 'env': {},
    'port': 0, 'autostart': false, 'keep-awake-for': 'off', 'restart-on-exit': false, ...fields,
});

async function harness({services = [service()], settings = {}} = {}) {
    const ports = testPorts({settings: {services, ...settings}, state: {'welcome-done': true}});
    const app = createApp(ports);
    await settle();
    const h = {
        ports, app, services: app.services,
        seconds: s => ports.clock.advance(s * 1000),
        now: () => ports.clock.now().getTime(),
        run: id => ports.processes.last(id),
        log: id => app.services.logLines(id).map(l => l.text),
        toast: () => app.hud.state.toast?.text ?? null,
        notification: id => ports.notifier.shown.get(`service.failed:${id}`) ?? null,
        /** Starts `id` and lets the login shell answer. */
        start: async (id = ID) => {
            app.services.start(id);
            await settle();
        },
        /** The run exits by itself after `after` seconds. */
        exits: async (id, how, after = 0) => {
            ports.clock.advance(after * 1000);
            ports.processes.last(id).exit(how);
            await settle();
        },
        dispose: () => app.dispose(),
    };
    return h;
}

// Start and stop.

test('enable stops every HeadsUp scope by pattern, then starts the autostart ones (N4b)', async () => {
    const h = await harness({services: [service({autostart: true}), service({id: ID2, name: 'DB', command: 'postgres'})]});
    assertEqual([h.ports.processes.stoppedAll, h.ports.processes.runs.map(r => r.spec.id)], [1, [ID]]);
    assertEqual(h.toast(), null, 'autostart doesn\'t toast');
    h.dispose();
});

test('start runs the command through the login shell, in its folder, with its env, in its own scope', async () => {
    const h = await harness({services: [service({env: {NODE_ENV: 'development', TOKEN: 's3cr3t'}})]});
    await h.start();
    const run = h.run(ID);
    assertEqual([run.spec.command, run.spec.cwd, run.spec.shell, run.spec.env], ['npm run dev', '~/code/web', '/bin/bash',
        [{key: 'NODE_ENV', value: 'development'}, {key: 'TOKEN', value: 's3cr3t'}]]);
    assertEqual([h.services.stateOf(ID).kind, h.toast()], ['starting', 'Started Web dev server']);
    assertEqual(h.log(ID), ['$ npm run dev', 'starting…'], 'env values never reach the log');
    h.seconds(3);
    assertEqual(h.services.stateOf(ID), {kind: 'running', pid: run.pid, since: h.now() - 3000, port: null});
    h.dispose();
});

test('a shell HeadsUp doesn\'t support runs in bash, and says so', async () => {
    const h = await harness();
    h.ports.processes.shell = {shell: '/bin/bash', fallback: 'fish'};
    await h.start();
    assertEqual(h.log(ID).includes("fish isn't supported for services; running in bash"), true);
    h.dispose();
});

test('output reaches the log under the read budget, the views hear of it at most every 100 ms', async () => {
    const h = await harness();
    await h.start();
    let changes = 0;
    h.services.on('changed', () => changes++);
    h.run(ID).write('Listening on :3000\nready\n');
    await settle();
    assertEqual(h.log(ID).slice(2), [], 'nothing is read between ticks');
    h.seconds(0.1);
    await settle();
    assertEqual(h.log(ID).slice(2), ['Listening on :3000', 'ready']);
    const before = changes;
    h.seconds(0.1);
    assertEqual(changes, before + 1, 'the views hear of it at the next tick');
    h.dispose();
});

test('stop stops the run\'s scope; its exit is not a failure', async () => {
    const h = await harness();
    await h.start();
    h.services.stop(ID);
    await settle();
    h.seconds(0.1);
    await settle();
    assertEqual([h.run(ID).stops >= 1, h.services.stateOf(ID).kind, h.toast(), h.notification(ID)], [true, 'stopped', 'Stopped Web dev server', null]);
    assertEqual(h.log(ID).at(-1), 'process exited (SIGTERM)');
    h.dispose();
});

test('N4b: every exit stops the run\'s scope, so what it left behind goes too', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    await h.exits(ID, {code: 0});
    assertEqual(h.run(ID).stops, 1);
    h.dispose();
});

test('an exit on its own is a failure, with a notification and the red dot', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    await h.exits(ID, {code: 1}, 60);
    assertEqual(h.services.stateOf(ID), {kind: 'failed', exitCode: 1, at: h.now(), gaveUpSince: null});
    const n = h.notification(ID);
    assertEqual([n.title, n.body, n.category, n.actions.map(a => a.label)], ['Web dev server stopped', 'It exited with code 1.', 'service.failed', ['Show Logs']]);
    assertEqual([h.services.failureUnseen, h.app.tabActivity().services], [true, 'alert']);
    assertEqual(h.services.openLogs, null, 'it ran: its logs don\'t open by themselves');
    h.services.sawServices();
    assertEqual(h.services.failureUnseen, false);
    h.dispose();
});

test('failing to start opens the logs; a launch error is logged and fails', async () => {
    const h = await harness();
    await h.start();
    await h.exits(ID, {code: 127}, 1);
    assertEqual([h.services.stateOf(ID).kind, h.services.openLogs], ['failed', ID]);
    h.dispose();
    const refused = await harness();
    refused.ports.processes.refuse = true;
    await refused.start();
    assertEqual([refused.services.stateOf(ID).exitCode, refused.log(ID).at(-1), refused.services.openLogs], [-1, "couldn't start: spawn failed", ID]);
    refused.dispose();
});

test('Show Logs from the notification opens Services with that log; ignored while locked', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    await h.exits(ID, {code: 1});
    h.ports.session.lock();
    h.ports.notifier.answer(`service.failed:${ID}`, 'show-logs');
    assertEqual(h.services.openLogs, null);
    h.ports.session.unlock();
    h.ports.notifier.answer(`service.failed:${ID}`, 'show-logs');
    assertEqual([h.services.openLogs, h.services.failureUnseen, h.app.hud.state.tab, h.app.hud.state.focused], [ID, false, 'services', true]);
    h.dispose();
});

test('restart stops, then starts again once it has exited', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    const first = h.run(ID);
    h.services.restart(ID);
    await settle();
    assertEqual([first.stops >= 1, h.ports.processes.runs.length, h.services.stateOf(ID).kind], [true, 2, 'starting']);
    h.dispose();
});

test('removing a running service stops it; it leaves nothing once it has exited', async () => {
    const h = await harness();
    await h.start();
    deleteService(h.app.settings, ID);
    await settle();
    assertEqual([h.run(ID).stops >= 1, h.services.stateOf(ID).kind, h.services.logLines(ID), h.services.snapshot], [true, 'stopped', [], {running: 0, starting: 0, failed: 0}]);
    h.dispose();
});

test('Stop All Services stops every live one and any waiting restart', async () => {
    const h = await harness({services: [service(), service({'id': ID2, 'name': 'DB', 'restart-on-exit': true})]});
    await h.start(ID);
    await h.start(ID2);
    h.seconds(3);
    await h.exits(ID2, {code: 1});
    h.services.stopAll();
    await settle();
    assertEqual([h.services.stateOf(ID).kind, h.services.stateOf(ID2).kind, h.toast()], ['stopped', 'stopped', 'Stopped all services']);
    h.dispose();
});

test('the menu counts running, starting and failed', async () => {
    const h = await harness({services: [service(), service({id: ID2, name: 'DB'})]});
    await h.start(ID);
    await h.start(ID2);
    assertEqual(h.services.snapshot, {running: 0, starting: 2, failed: 0});
    h.seconds(3);
    await h.exits(ID2, {code: 1});
    assertEqual(h.services.snapshot, {running: 1, starting: 0, failed: 1});
    h.dispose();
});

test('the actions follow each service\'s state', async () => {
    const h = await harness();
    const ids = () => h.app.actions.actions.filter(a => a.kind === 'service').map(a => a.id.split(':')[0]);
    assertEqual(ids(), ['service.start']);
    const start = h.app.actions.actions.find(a => a.id === `service.start:${ID}`);
    assertEqual([start.title, start.subtitle, start.suggest], ['Start Web dev server', 'npm run dev · ~/code/web',
        {confirm: {verb: 'Start', name: 'Web dev server', command: 'npm run dev', cwd: '~/code/web'}}]);
    await h.start();
    assertEqual(ids(), ['service.stop', 'service.restart']);
    h.dispose();
});

// Restart if it stops.

const restarting = () => harness({services: [service({'restart-on-exit': true})]});
async function running(h) {
    await h.start();
    h.seconds(3);
}
async function restarts(h) {
    const s = h.services.stateOf(ID);
    h.ports.clock.advance(s.at - h.now());
    await settle();
    h.seconds(3);
}

test('any exit restarts, with no toast or notification', async () => {
    const h = await restarting();
    await running(h);
    await h.exits(ID, {code: 0});
    assertEqual(h.services.stateOf(ID), {kind: 'waitingToRestart', attempt: 1, at: h.now() + 1000, lastExit: 0});
    assertEqual(h.log(ID).slice(-2), ['process exited (code 0)', 'restarting in 1 s (restart 1 of 5)']);
    h.app.hud.toast('other');
    h.seconds(1);
    await settle();
    assertEqual([h.services.stateOf(ID).kind, h.toast(), h.ports.processes.runs.length], ['starting', 'other', 2]);
    h.seconds(3);
    await h.exits(ID, {signal: 15});
    assertEqual(h.services.stateOf(ID), {kind: 'waitingToRestart', attempt: 2, at: h.now() + 2000, lastExit: 143});
    assertEqual([h.notification(ID), h.services.failureUnseen], [null, false]);
    h.dispose();
});

test('the delays grow, then it gives up on the sixth stop', async () => {
    const h = await restarting();
    await running(h);
    const firstExit = h.now() + 5000;
    const waits = [];
    for (let i = 0; i < MAX_RESTARTS; i++) {
        await h.exits(ID, {code: 1}, 5);
        waits.push(h.services.stateOf(ID).at - h.now());
        await restarts(h);
    }
    assertEqual(waits, [1000, 2000, 5000, 10_000, 30_000]);
    await h.exits(ID, {code: 1}, 5);
    assertEqual(h.services.stateOf(ID), {kind: 'failed', exitCode: 1, at: h.now(), gaveUpSince: firstExit});
    assertEqual([h.log(ID).at(-1), h.services.failureUnseen, h.services.openLogs], ['stopped again after 5 restarts; not restarting', true, ID]);
    assertEqual([h.notification(ID).title, h.notification(ID).body], ['Web dev server keeps stopping', 'It stopped again after 5 restarts, so HeadsUp stopped restarting it.']);
    h.dispose();
});

test('a run of five minutes starts the count over', async () => {
    const h = await restarting();
    await running(h);
    for (let i = 0; i < 3; i++) {
        await h.exits(ID, {code: 1}, 10);
        await restarts(h);
    }
    await h.exits(ID, {code: 1}, 300);
    assertEqual(h.services.stateOf(ID).attempt, 1);
    h.dispose();
});

test('a user\'s start that fails at once stays failed; an automatic one is counted quietly', async () => {
    const h = await restarting();
    await h.start();
    await h.exits(ID, {code: 127}, 1);
    assertEqual([h.services.stateOf(ID).kind, h.notification(ID).title], ['failed', 'Web dev server stopped']);
    h.dispose();
    const quiet = await restarting();
    await running(quiet);
    await quiet.exits(ID, {code: 1}, 10);
    quiet.seconds(1);
    await settle();
    await quiet.exits(ID, {code: 1}, 1);
    assertEqual([quiet.services.stateOf(ID).attempt, quiet.notification(ID)], [2, null]);
    quiet.dispose();
});

test('stop during the wait cancels the restart; restart switched off too', async () => {
    const h = await restarting();
    await running(h);
    await h.exits(ID, {code: 1});
    h.services.toggleRun(ID);
    assertEqual([h.services.stateOf(ID).kind, h.log(ID).at(-1), h.toast()], ['stopped', 'restart cancelled', 'Stopped Web dev server']);
    h.seconds(60);
    assertEqual(h.ports.processes.runs.length, 1);
    await h.start();
    h.seconds(3);
    await h.exits(ID, {code: 1});
    h.ports.files.folders.add('~/code/web');
    assertEqual(await saveService(h.app.settings, h.ports.files, {...h.services.definition(ID), restartOnExit: false}), {});
    assertEqual([h.services.stateOf(ID).kind, h.log(ID).at(-1)], ['stopped', 'restart cancelled']);
    h.dispose();
});

test('start or restart during the wait starts at once and resets the count', async () => {
    for (const useRestart of [false, true]) {
        const h = await restarting();
        await running(h);
        for (let i = 0; i < 3; i++) {
            await h.exits(ID, {code: 1}, 10);
            await restarts(h);
        }
        await h.exits(ID, {code: 1}, 10);
        const runs = h.ports.processes.runs.length;
        if (useRestart)
            h.services.restart(ID);
        else
            h.services.start(ID);
        await settle();
        assertEqual([h.services.stateOf(ID).kind, h.ports.processes.runs.length], ['starting', runs + 1]);
        h.seconds(30);
        assertEqual(h.ports.processes.runs.length, runs + 1, 'the armed wait doesn\'t start it again');
        await h.exits(ID, {code: 1}, 10);
        assertEqual(h.services.stateOf(ID).attempt, 1);
        h.dispose();
    }
});

// Ports.

test('a set port: starting until it answers; silent after 30 s; never tried once stopped', async () => {
    const h = await harness({services: [service({port: 3000})]});
    await h.start();
    h.seconds(3);
    await settle();
    assertEqual(h.services.stateOf(ID).kind, 'starting', 'a silent port is never running at 3 s');
    h.seconds(27);
    await settle();
    assertEqual([h.services.stateOf(ID).kind, h.services.screen(h.now()).rows[0].meta], ['running', 'Running · nothing on :3000 yet']);
    h.ports.portProbe.answering.add(3000);
    h.seconds(5);
    await settle();
    assertEqual([h.services.stateOf(ID).port, h.services.screen(h.now()).rows[0].metaStyle, h.services.localUrl(ID)], [3000, 'accent', 'http://localhost:3000']);
    h.dispose();
});

test('without a set port, the probed port marks it running', async () => {
    const h = await harness();
    await h.start();
    h.ports.portProbe.listeningPort = 5173;
    h.seconds(2);
    await settle();
    assertEqual(h.services.stateOf(ID).port, 5173);
    h.dispose();
});

// Rules.

test('a service that breaks a rule can\'t start and says why', async () => {
    const h = await harness({services: [service({command: '  '}), service({id: 'not-a-uuid', name: 'Bad id'})]});
    await h.start(ID);
    await h.start('not-a-uuid');
    assertEqual(h.ports.processes.runs.filter(r => r.spec.command === '  ' || r.spec.id === 'not-a-uuid'), []);
    const rows = h.services.screen(h.now()).rows;
    assertEqual([rows[0].meta, rows[0].action], ["Can't start · enter a command to run", {kind: 'edit', title: 'Edit…'}]);
    assertEqual(rows[1].meta, "Can't start · this service's id isn't valid. Remove it and add it again");
    h.dispose();
});

test('save checks the rules and the folder; a new one is added, an edit replaces', async () => {
    const h = await harness({services: []});
    const d = {id: ID, name: ' Web ', command: 'npm run dev', cwd: '/nowhere', env: [], port: null, autostart: false, keepAwake: 'off', restartOnExit: false};
    assertEqual(await saveService(h.app.settings, h.ports.files, d), {cwd: "This folder doesn't exist."});
    assertEqual(await saveService(h.app.settings, h.ports.files, {...d, cwd: '~', port: 70000}), {port: 'Enter a port from 1 to 65535, or leave it empty.'});
    assertEqual(await saveService(h.app.settings, h.ports.files, {...d, cwd: '~'}), {});
    assertEqual(await saveService(h.app.settings, h.ports.files, {...d, cwd: '~', command: 'npm start'}), {});
    assertEqual(h.services.definitions.map(x => [x.name, x.command]), [['Web', 'npm start']]);
    h.dispose();
});

// The tab.

test('an empty tab offers to add one; rows read as designed; the drawer shows timed lines', async () => {
    const empty = await harness({services: []});
    assertEqual(empty.services.screen(empty.now()).empty, {title: 'No services yet', text: 'Add a dev server, a database or a local model, then start and stop it here.', add: 'Add a service…'});
    empty.dispose();
    const h = await harness({services: [service({'keep-awake-for': '2h', 'restart-on-exit': true})]});
    let row = h.services.screen(h.now()).rows[0];
    assertEqual([row.status, row.meta, row.action, row.keepsAwake, row.restarts, row.log], ['stopped', null, {kind: 'run', title: 'Start', glyph: 'play', primary: true}, true, true, null]);
    h.services.toggleLogs(ID);
    assertEqual(h.services.screen(h.now()).rows[0].log, {lines: [], emptyText: 'No output yet. Start the service to see its logs.', clear: 'Clear'});
    await h.start();
    h.seconds(65);
    row = h.services.screen(h.now()).rows[0];
    assertEqual([row.status, row.meta, row.action.title], ['running', '2m', 'Stop']);
    assertEqual(row.log.lines.map(l => l.text), ['$ npm run dev', 'starting…', 'keeping the computer awake']);
    await h.exits(ID, {code: 1});
    row = h.services.screen(h.now() + 4000).rows[0];
    assertEqual([row.status, row.meta, row.metaStyle, row.accessibleValue], ['starting', 'Restarting in 1 s · exited with code 1', 'warn', 'restarting in 1 second']);
    h.dispose();
});

// Keep awake.

test('a Keep awake service holds while it runs, logs each change, and releases on stop', async () => {
    const h = await harness({services: [service({'keep-awake-for': 'unlimited'})]});
    await h.start();
    await settle();
    assertEqual([h.ports.inhibitor.held.map(x => [x.flags, x.reason]), h.services.serviceHolds], [[[4, 'HeadsUp: Web dev server']], [{name: 'Web dev server', awake: 'holding'}]]);
    assertEqual(h.app.caffeine.screen(h.now()).header.title, 'Kept awake by Web dev server');
    h.services.stop(ID);
    await settle();
    assertEqual([h.ports.inhibitor.held, h.log(ID).includes('no longer keeping the computer awake')], [[], true]);
    h.dispose();
});

test('a refused hold doesn\'t stop the service and says so', async () => {
    const h = await harness({services: [service({'keep-awake-for': 'unlimited'})]});
    h.ports.inhibitor.refuse.add(4);
    await h.start();
    await settle();
    assertEqual([h.services.stateOf(ID).kind, h.services.serviceHolds[0].awake, h.log(ID).at(-1)], ['starting', 'refused', "GNOME didn't let HeadsUp keep the computer awake"]);
    h.dispose();
});

test('the limit counts from the last activity: away releases, the next input takes it back', async () => {
    const h = await harness({services: [service({'keep-awake-for': '30m'})]});
    await h.start();
    await settle();
    h.seconds(29 * 60);
    h.ports.idle.input();
    h.seconds(29 * 60);
    await settle();
    assertEqual(h.ports.inhibitor.held.length, 1, 'input in between counts');
    h.seconds(60);
    await settle();
    assertEqual([h.ports.inhibitor.held.length, h.log(ID).at(-1)], [0, 'no longer keeping the computer awake: away for 30m']);
    assertEqual(h.services.screen(h.now()).rows[0].keepAwakeAway, true);
    h.ports.idle.input();
    await settle();
    assertEqual([h.ports.inhibitor.held.length, h.log(ID).at(-1)], [1, "keeping the computer awake again: you're back"]);
    h.dispose();
});

test('only on power adapter pauses a service\'s hold and resumes it', async () => {
    const h = await harness({services: [service({'keep-awake-for': 'unlimited'})], settings: {'only-on-ac': true}});
    await h.start();
    await settle();
    h.ports.power.set(true);
    assertEqual([h.services.serviceHolds[0].awake, h.log(ID).at(-1)], ['pausedOnBattery', 'keeping awake paused: on battery']);
    h.ports.power.set(false);
    await settle();
    assertEqual([h.services.serviceHolds[0].awake, h.log(ID).at(-1)], ['holding', 'keeping awake resumed: on power']);
    h.dispose();
});

test('output printed just before an exit comes before the exit line; the state changes at once (Nick 1)', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    const run = h.run(ID);
    run.write('boom\n');
    run.exit({code: 1});
    await settle();
    assertEqual(h.services.stateOf(ID).kind, 'failed', 'at once');
    h.seconds(0.1);
    await settle();
    h.seconds(0.1);
    await settle();
    assertEqual(h.log(ID).slice(-2), ['boom', 'process exited (code 1)']);
    h.dispose();
});

test('a pipe still open after the exit (a child writing) is read for 1 s, then the exit line', async () => {
    const h = await harness();
    await h.start();
    h.seconds(3);
    const run = h.run(ID);
    run.ignoresStop = true;
    run.exit({code: 0}, {endOutput: false});
    await settle();
    run.write('late\n');
    for (let i = 0; i < 5; i++) {
        h.seconds(0.1);
        await settle();
    }
    assertEqual(h.log(ID).includes('process exited (code 0)'), false);
    for (let i = 0; i < 6; i++) {
        h.seconds(0.1);
        await settle();
    }
    assertEqual(h.log(ID).slice(-2), ['late', 'process exited (code 0)']);
    h.dispose();
});

test('only the open drawer gets lines, at most the last 500', async () => {
    const h = await harness();
    await h.start();
    h.run(ID).write(Array.from({length: 800}, (_, i) => `line ${i}`).join('\n') + '\n');
    for (let i = 0; i < 3; i++) {
        h.seconds(0.1);
        await settle();
    }
    assertEqual(h.services.screen(h.now()).rows[0].log, null);
    h.services.toggleLogs(ID);
    const lines = h.services.screen(h.now()).rows[0].log.lines;
    assertEqual([lines.length, lines.at(-1).text], [500, 'line 799']);
    h.dispose();
});

test('open in browser: only a running service with a known port, read at click time; the HUD closes', async () => {
    const h = await harness({services: [service({port: 3000})]});
    h.services.openInBrowser(ID);
    assertEqual(h.ports.links.opened, [], 'stopped');
    await h.start();
    h.app.hud.focus('services');
    h.ports.portProbe.answering.add(3000);
    h.seconds(1);
    await settle();
    h.services.openInBrowser(ID);
    assertEqual([h.ports.links.opened, h.app.hud.state.visible], [['http://localhost:3000'], false]);
    h.dispose();
});

test('logText: the whole log, one timed line each, for Copy All', async () => {
    const h = await harness();
    await h.start();
    const text = h.services.logText(ID);
    assertEqual(/^\d\d:\d\d:\d\d {2}\$ npm run dev\n\d\d:\d\d:\d\d {2}starting…$/.test(text), true, text);
    h.dispose();
});

test('draftChanged: only a draft that differs from what is saved', () => {
    const saved = readDefinition(service({env: {A: '1'}}));
    const draft = draftOf(saved);
    assertEqual([draftChanged(draft, saved), draftChanged({...draft, name: 'Other'}, saved), draftChanged({...draft, env: [{key: 'A', value: '2'}]}, saved)], [false, true, true]);
    assertEqual([draftChanged(draftOf(null), null), draftChanged({...draftOf(null), command: 'x'}, null)], [false, true]);
});

test('running-services: the live ids, written only on a change; [] at dispose; a stale list is replaced', async () => {
    const h = await harness({services: [service()]});
    h.ports.state.writes = [];
    await h.start();
    h.services.stop(ID);
    await settle();
    h.seconds(0.1);
    await settle();
    h.dispose();
    assertEqual(h.ports.state.writes.filter(([key]) => key === 'running-services'), [['running-services', [ID]], ['running-services', []]]);
    const stale = testPorts({settings: {services: [service()]}, state: {'welcome-done': true, 'running-services': [ID, ID2]}});
    const app = createApp(stale);
    await settle();
    assertEqual(stale.state.get('running-services'), []);
    app.dispose();
});

test('drawer text and service names are shown without escape sequences, controls or bidi (Scan S3P-1)', async () => {
    const h = await harness({services: [service({name: 'Web‮ \u001B[31mdev\u0007'})]});
    await h.start();
    h.seconds(3);
    h.run(ID).write('\u001B[31merror\u001B[0m: ‮bad\u0000\n');
    h.seconds(0.1);
    await settle();
    h.services.toggleLogs(ID);
    const row = h.services.screen(h.now()).rows[0];
    assertEqual([row.name, row.log.lines.at(-1).text], ['Web dev', 'error: bad']);
    await h.exits(ID, {code: 1});
    assertEqual(h.notification(ID).title, 'Web dev stopped');
    h.dispose();
});

test('the action\'s confirmation card and the row show the command and folder with controls visible (F1)', async () => {
    const h = await harness({services: [service({command: 'echo hi \u202E#', cwd: '~/a\u001Bb'})]});
    const start = h.app.actions.actions.find(a => a.id === `service.start:${ID}`);
    assertEqual([start.suggest.confirm.command, start.suggest.confirm.cwd, start.subtitle], ['echo hi ⟨U+202E⟩#', '~/a⟨ESC⟩b', 'echo hi ⟨U+202E⟩# · ~/a⟨ESC⟩b']);
    assertEqual(h.services.screen(h.now()).rows[0].commandLine, 'echo hi ⟨U+202E⟩# · ~/a⟨ESC⟩b');
    h.dispose();
});
