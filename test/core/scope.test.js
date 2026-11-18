import {test, assertEqual} from '../harness.js';
import {Scope} from '../../lib/core/scope.js';
import {Emitter} from '../../lib/core/emitter.js';

test('dispose runs every handle, newest first, and keeps going past an error', () => {
    const scope = new Scope();
    const order = [];
    scope.add(() => order.push(1));
    scope.add(() => {
        throw new Error('boom');
    });
    scope.add({dispose: () => order.push(3)});
    const errors = scope.dispose();
    assertEqual(order, [3, 1]);
    assertEqual(errors.map(e => e.message), ['boom']);
    assertEqual(scope.size, 0);
});

test('a handle disposed early is forgotten and runs once', () => {
    const scope = new Scope();
    let runs = 0;
    const handle = scope.add(() => runs++);
    handle.dispose();
    handle.dispose();
    scope.dispose();
    assertEqual([runs, scope.size], [1, 0]);
});

test('a handle added after dispose is disposed at once', () => {
    const scope = new Scope();
    scope.dispose();
    let runs = 0;
    scope.add(() => runs++);
    assertEqual([runs, scope.size], [1, 0]);
});

test('connect disconnects; a child goes with its parent, and alone', () => {
    const scope = new Scope();
    const object = {ids: new Set(), connect(_s, _fn) {
        this.ids.add(7);
        return 7;
    }, disconnect(id) {
        this.ids.delete(id);
    }};
    const child = scope.child();
    child.connect(object, 'changed', () => {});
    assertEqual(object.ids.size, 1);
    scope.dispose();
    assertEqual([object.ids.size, child.disposed, scope.size], [0, true, 0]);

    const parent = new Scope();
    parent.child().dispose();
    assertEqual(parent.size, 0);
});

test('emitter: listeners in order, removed by their handle', () => {
    const emitter = new Emitter();
    const seen = [];
    const a = emitter.on('changed', x => seen.push(`a${x}`));
    emitter.on('changed', x => seen.push(`b${x}`));
    emitter.emit('changed', 1);
    a.dispose();
    emitter.emit('changed', 2);
    assertEqual(seen, ['a1', 'b1', 'b2']);
    assertEqual(emitter.size, 1);
});
