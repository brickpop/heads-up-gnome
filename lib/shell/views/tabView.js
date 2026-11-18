// What every tab view shares: it draws its store's screen(now), rebuilds when the store
// changes, and once a second (while the HUD shows) updates only the text that time changes.
//
// A rebuild keeps the keyboard focus: each focusable control carries a `focusKey`, and the
// rebuilt view gives the focus back to the control with the same key. Before the old controls
// go, the focus is parked on the prompt: a destroyed focused actor leaves the focus on the
// stage, which the HUD would read as the shell taking its keyboard.
//
// A subclass provides screen(now) (from its store), build(screen) (the actors, top to bottom)
// and update(screen) (the tick); it rebuilds by calling render(). Time comes from the app's
// clock, never Date.now(), so every view reads the same moment.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class TabView {
    #scope;
    #parkFocus;
    #now;
    /** Owns what one build connects (hover labels); disposed by the next build. */
    #buildScope = null;

    /**
     * @param {object} deps
     * @param {import('../../core/scope.js').Scope} deps.scope owned by the HUD view
     * @param {() => void} deps.parkFocus puts the keyboard focus on the prompt
     * @param {() => number} deps.now the app's clock (ms)
     * @param {string} deps.styleClass the view's root style
     */
    constructor({scope, parkFocus, now, styleClass}) {
        this.#scope = scope;
        this.#parkFocus = parkFocus;
        this.#now = now;
        this.actor = new St.BoxLayout({style_class: styleClass, orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    }

    /** The scope of the current build, for what it connects. */
    get buildScope() {
        return this.#buildScope;
    }

    /** Rebuilds from the store, keeping the keyboard focus on the same control. */
    render() {
        const focusKey = this.#focusedKey();
        if (this.actor.contains(global.stage.key_focus))
            this.#parkFocus();
        this.#buildScope?.dispose();
        this.#buildScope = this.#scope.child();
        this.actor.destroy_all_children();
        for (const child of this.build(this.screen(this.#now())))
            this.actor.add_child(child);
        if (focusKey)
            this.#refocus(focusKey);
    }

    /** Once a second while the HUD shows. */
    tick() {
        this.update(this.screen(this.#now()));
    }

    dispose() {
        this.#scope.dispose();
        this.actor.destroy();
    }

    #focusedKey() {
        let actor = global.stage.key_focus;
        while (actor && actor !== this.actor) {
            if (actor.focusKey)
                return actor.focusKey;
            actor = actor.get_parent();
        }
        return null;
    }

    /** The control with `key` that can take focus (in a group, the selected item). */
    #refocus(key) {
        const find = actor => {
            for (const child of actor.get_children()) {
                if (child.focusKey === key && child.can_focus)
                    return child;
                const found = find(child);
                if (found)
                    return found;
            }
            return null;
        };
        find(this.actor)?.grab_key_focus();
    }
}
