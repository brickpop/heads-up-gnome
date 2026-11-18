// G4: every notification's title and body is fixed copy from strings.js, filled only with
// numbers (a focus length); never model, tool or service text. Buttons come from the category.

import {test, assertEqual, testPorts} from '../harness.js';
import {createApp} from '../../lib/core/app.js';
import {CATEGORY_ACTIONS} from '../../lib/core/notifications.js';
import {Notifications} from '../../lib/core/strings.js';

const ALLOWED_TITLES = [/^Focus done · \d+ min$/, /^Break over$/, /^Time for a break$/];
const ALLOWED_BODIES = [
    Notifications.focusDoneBody, Notifications.breakOverBody, Notifications.snoozeOverBackBody,
    Notifications.snoozeOverBreakBody(null),
].map(text => new RegExp(`^${text.replace(/[.?*]/g, '\\$&')}$`))
    .concat([/^Snooze is over\. Your \d+ min focus is done\.$/, /^Focus started · \d+ min$/]);

test('every post in a full round is fixed copy with its category\'s buttons', () => {
    const ports = testPorts({state: {'welcome-done': true}});
    const app = createApp(ports);
    const minutes = m => ports.clock.advance(m * 60_000);
    app.focus.start(40);
    minutes(40);
    app.focus.snooze(2);
    minutes(2);
    app.focus.startBreak();
    minutes(5);
    app.focus.snooze(5);
    minutes(5);
    app.focus.editor.setAutoStartNextFocus(true);
    app.focus.start(25);
    minutes(25);
    app.focus.startBreak();
    minutes(5);
    app.focus.takeBreakNow();
    app.focus.snooze(2);
    minutes(2);
    const posts = ports.notifier.posts;
    assertEqual(posts.length >= 7, true, `${posts.length} posts`);
    for (const n of posts) {
        assertEqual(ALLOWED_TITLES.some(r => r.test(n.title)), true, n.title);
        assertEqual(ALLOWED_BODIES.some(r => r.test(n.body)), true, n.body);
        assertEqual(n.actions.map(a => a.id), CATEGORY_ACTIONS[n.category], n.category);
        assertEqual(n.actions.length <= 3, true);
    }
    assertEqual(new Set(posts.map(n => n.category)), new Set(['focus.end', 'break.end', 'break.autostart']));
    app.dispose();
});
