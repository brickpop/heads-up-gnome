// The action catalogue (the Mac's ActionRegistry; Action autocomplete spec): each feature adds
// a provider for its section, and the catalogue lists their actions section by section.
// Providers build their actions from their store's state each time they're read, so the
// catalogue always matches what runs.
//
// An action is {id, title, subtitle, kind, glyph, keywords, suggest, run}: `kind` is shown on
// its row and searched; `suggest` says whether a model may suggest it: 'never', 'oneClick',
// or {confirm: {verb, name, command?, cwd?}}.

import {match, parseQuickTimer} from './matcher.js';
import {TABS} from './hud.js';
import {FOCUS_LENGTHS} from './focusSettings.js';
import * as format from './format.js';
import {timeLeft} from './focusMachine.js';
import {Caffeine, Focus, Services, Tabs} from './strings.js';
import {displayName, firstProblem} from './serviceDefinition.js';
import {showControls} from './sanitize.js';
import {EXTEND_MINUTES} from './caffeine.js';

/** The catalogue's sections, in the order their rows show. */
export const SECTIONS = Object.freeze(['focus', 'caffeine', 'model', 'service', 'command', 'chat', 'theme', 'view']);

export class ActionRegistry {
    #providers = [];
    /** The row for a typed `/start 35` or `/break 5`: made per query, never in the catalogue. */
    #quickTimer = () => null;

    /** Adds a provider to `section`, after the ones already in it. */
    add(section, provider) {
        if (!SECTIONS.includes(section))
            throw new Error(`unknown section ${section}`);
        this.#providers.push({section, provider});
        this.#providers.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));
    }

    /** Sets what makes the typed timer's row: `(kind, minutes) => action`. */
    setQuickTimer(make) {
        this.#quickTimer = make;
    }

    /** Every action, in catalogue order. */
    get actions() {
        return this.#providers.flatMap(({provider}) => provider());
    }

    /** The suggestion rows for the prompt's text; see matcher.js. */
    match(input, {ask, inConversation}) {
        const timer = parseQuickTimer(input.trim());
        const typed = timer && {timer, action: timer.kind === 'invalid' ? null : this.#quickTimer(timer.kind, timer.minutes)};
        return match(input, this.actions, {ask, inConversation, typed});
    }
}

/** The Focus section: Start 25/40/50 min focus, Stop timer while one runs, Take a break now. */
export function focusActions(focus, hud) {
    const actions = FOCUS_LENGTHS.map(minutes => ({
        id: `focus.start:${minutes}`, title: Focus.startAction(minutes), subtitle: Focus.startSubtitle,
        kind: 'focus', glyph: 'timer', keywords: 'pomodoro focus timer work start', suggest: 'oneClick',
        run: () => {
            focus.start(minutes);
            hud.selectTab('focus');
            // After the tab switch, which would cancel it.
            focus.hideAfterStart();
        },
    }));
    const kind = focus.phase.kind;
    if (kind === 'focus' || kind === 'rest') {
        actions.push({
            id: 'focus.stop', title: Focus.stopAction, subtitle: Focus.stopSubtitle(kind === 'rest'),
            kind: 'focus', glyph: 'stop', keywords: 'pomodoro focus timer stop end cancel', suggest: 'oneClick',
            run: () => focus.stop(),
        });
    }
    actions.push({
        id: 'focus.break', title: Focus.breakNowAction, subtitle: Focus.breakNowSubtitle,
        kind: 'focus', glyph: 'droplet', keywords: 'pomodoro break rest', suggest: 'oneClick',
        run: () => {
            focus.takeBreakNow();
            hud.selectTab('focus');
        },
    });
    return actions;
}

/**
 * The row a valid `/start 35` or `/break 5` puts on top: "Start 35 min focus" · "focus · ends
 * 15:42". Made per query, outside the catalogue, so a model can never suggest it (F1).
 */
export function quickTimerAction(kind, minutes, {focus, hud, clock}) {
    const isFocus = kind === 'focus';
    const now = clock.now().getTime();
    const p = focus.phase;
    const running = p.kind === 'focus' || p.kind === 'rest';
    const subtitle = running
        ? Focus.replaces(p.kind === 'rest', format.wholeMinutes(timeLeft(p.run, now) / 1000, 'up'))
        : Focus.endsSubtitle(!isFocus, format.time(new Date(now + minutes * 60_000), clock.timeFormat()));
    return {
        id: isFocus ? `focus.start:any:${minutes}` : `focus.break:any:${minutes}`,
        title: isFocus ? Focus.startAction(minutes) : Focus.takeBreakAction(minutes),
        subtitle, kind: 'focus', glyph: isFocus ? 'timer' : 'droplet', keywords: '', suggest: 'never',
        run: () => {
            if (isFocus)
                focus.start(minutes);
            else
                focus.takeBreak(minutes);
            hud.selectTab('focus');
            focus.hideAfterStart();
        },
    };
}

/** The Caffeine section: extend while on with an end, Caffeine off while on, Keep awake for… */
export function caffeineActions(caffeine) {
    const actions = [];
    if (caffeine.isOn && caffeine.endsAt !== null) {
        for (const minutes of EXTEND_MINUTES) {
            actions.push({
                id: `caffeine.extend:${minutes}`, title: Caffeine.extendAction(minutes), subtitle: Caffeine.extendSubtitle,
                kind: 'caffeine', glyph: 'plus', keywords: 'caffeine awake extend more add longer', suggest: 'oneClick',
                run: () => caffeine.extend(minutes),
            });
        }
    }
    if (caffeine.isOn) {
        actions.push({
            id: 'caffeine.off', title: Caffeine.offAction, subtitle: Caffeine.offSubtitle,
            kind: 'caffeine', glyph: 'cup', keywords: 'caffeine awake sleep off stop', suggest: 'oneClick',
            run: () => caffeine.turnOff(),
        });
    }
    for (const duration of ['1h', '2h', 'until-off']) {
        actions.push({
            id: `caffeine.on:${duration}`, title: Caffeine.keepAwakeAction(duration), subtitle: Caffeine.keepAwakeSubtitle,
            kind: 'caffeine', glyph: 'cup', keywords: 'caffeine awake sleep screensaver on', suggest: 'oneClick',
            run: () => caffeine.keepAwake(duration),
        });
    }
    return actions;
}

/**
 * The Services section: Start for each that can start, Stop and Restart for each live one. A
 * model may suggest them only with a confirmation naming the command and folder (F1).
 */
export function serviceActions(services) {
    const actions = [];
    for (const d of services.definitions) {
        // The card a model's suggestion asks with shows exactly what runs, controls made visible (F1).
        const command = showControls(d.command);
        const cwd = showControls(d.cwd);
        const subtitle = Services.actionSubtitle(command, cwd);
        const name = displayName(d);
        const confirm = verb => ({confirm: {verb, name, command, cwd}});
        const state = services.stateOf(d.id).kind;
        const live = state === 'starting' || state === 'running';
        const waiting = state === 'waitingToRestart';
        if ((!live || waiting) && !firstProblem(d)) {
            actions.push({
                id: `service.start:${d.id}`, title: Services.startAction(name), subtitle, kind: 'service', glyph: 'server',
                keywords: `service server run start launch ${d.command}`, suggest: confirm('Start'), run: () => services.start(d.id),
            });
        }
        if (live || waiting) {
            actions.push({
                id: `service.stop:${d.id}`, title: Services.stopAction(name), subtitle, kind: 'service', glyph: 'server',
                keywords: `service server run stop kill ${d.command}`, suggest: confirm('Stop'), run: () => services.stop(d.id),
            });
            actions.push({
                id: `service.restart:${d.id}`, title: Services.restartAction(name), subtitle, kind: 'service', glyph: 'server',
                keywords: `service server run restart ${d.command}`, suggest: confirm('Restart'), run: () => services.restart(d.id),
            });
        }
    }
    return actions;
}

/** "Go to <tab>", one per tab. */
export function goToActions(hud) {
    return TABS.map(tab => ({
        id: `view.open:${tab}`, title: `Go to ${Tabs.title(tab)}`, subtitle: `view · Ctrl+${TABS.indexOf(tab) + 1}`,
        kind: 'view', glyph: tab, keywords: `open view go ${tab}${tab === 'focus' ? ' pomodoro' : ''}`, suggest: 'oneClick',
        run: () => hud.selectTab(tab),
    }));
}
