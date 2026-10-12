import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattleEventQueue, battleEventDuration, battleEventVersion } from '../lib/firefight/event-queue.mjs';

function fakeClock() {
    let time = 0, serial = 0;
    const tasks = new Map();
    return {
        now: () => time,
        setTimeout(fn, delay) { const id = ++serial; tasks.set(id, { fn, at: time + delay }); return id; },
        clearTimeout(id) { tasks.delete(id); },
        get size() { return tasks.size; },
        advance(ms) {
            const end = time + ms;
            for (;;) {
                const next = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                time = Math.max(time, next[1].at);
                tasks.delete(next[0]);
                next[1].fn();
            }
            time = end;
        },
        // Simulate a browser's heavily throttled timer rather than running on time.
        jump(ms) { time += ms; },
        flushLate() { for (const [id, task] of [...tasks]) { tasks.delete(id); task.fn(); } },
    };
}

const event = (version, sequence, kind = 'shoot', extra = {}) => ({
    id: `event-${version}-${sequence}`, kind, actorIds: ['a', 'b'],
    from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, hit: true, damage: 5,
    ...extra,
});
const snapshot = (version, log = [], extra = {}) => ({ scopeKey: 'battle:player:a', version, log, ...extra });
function fixture(options = {}) {
    const clock = fakeClock(), calls = [];
    const queue = createBattleEventQueue({ clock, onEffect: (effect, meta) => calls.push({ effect, ...meta }), ...options });
    return { clock, calls, queue, emitted: () => calls.filter(call => call.effect), animated: () => calls.filter(call => call.effect && call.animate) };
}

test('server ID revisions and renderer-compatible default lifetimes', () => {
    assert.equal(battleEventVersion(event(123, 151)), 123);
    assert.equal(battleEventVersion({ id: 'event-123-0123456789abcdef0123456789abcdef' }), 123);
    assert.equal(battleEventVersion({ id: 'event-x-1' }), null);
    assert.equal(battleEventVersion({ id: 'Ray' }), null);
    assert.equal(battleEventVersion({ id: 'event-9007199254740992-1' }), null);
    assert.equal(battleEventDuration({ kind: 'shoot' }), 1400);
    assert.equal(battleEventDuration({ kind: 'move' }), 1400);
    assert.equal(battleEventDuration({ kind: 'face' }), 220);
    assert.equal(battleEventDuration({ kind: 'control' }), 400);
});

test('initial projected history establishes a baseline and never replays on duplicate polling', () => {
    const { queue, clock, emitted } = fixture(), shot = event(5, 0);
    queue.ingest(snapshot(5, [shot]));
    for (let i = 0; i < 5; i++) { clock.advance(2000); queue.ingest(snapshot(5, [{ ...shot }])); }
    assert.deepEqual(emitted(), []);
    assert.equal(clock.size, 0);
    queue.dispose();
});

test('two-second poll with [shoot,end] emits the shot instead of losing it to end', () => {
    const { queue, clock, animated, calls } = fixture();
    queue.ingest(snapshot(1));
    clock.advance(2000);
    const shot = event(2, 0), end = event(3, 1, 'end');
    queue.ingest(snapshot(3, [shot, end]));
    assert.deepEqual(animated().map(call => call.effect.id), [shot.id]);
    assert.equal(queue.getState().currentEventId, shot.id);
    clock.advance(1399);
    assert.equal(queue.getState().currentEventId, shot.id);
    clock.advance(1);
    assert.equal(calls.at(-1).effect, null);
    assert.equal(clock.size, 0);
});

test('several events in one version preserve server log order and ID deduplication', () => {
    const { queue, clock, animated } = fixture();
    const face = event(2, 1, 'face'), shot = event(2, 2), reload = event(2, 3, 'reload');
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(2, [face, shot, shot, reload, event(2, 4, 'end')]));
    queue.ingest(snapshot(2, [face, shot, reload]));
    assert.deepEqual(animated().map(call => call.effect.id), [face.id]);
    clock.advance(220);
    assert.equal(animated().at(-1).effect.id, shot.id);
    clock.advance(1400);
    assert.equal(animated().at(-1).effect.id, reload.id);
    clock.advance(400);
    assert.deepEqual(animated().map(call => call.effect.id), [face.id, shot.id, reload.id]);
    assert.equal(clock.size, 0);
});

test('incrementally observed events in the same revision are delivered once', () => {
    const { queue, clock, animated } = fixture();
    const first = event(2, 0), second = event(2, 1);
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(2, [first]));
    queue.ingest(snapshot(2, [first, second]));
    clock.advance(2800);
    queue.ingest(snapshot(2, [first, second]));
    assert.deepEqual(animated().map(call => call.effect.id), [first.id, second.id]);
});

test('newer polls append without interrupting the current effect or duplicating earlier events', () => {
    const { queue, clock, animated } = fixture();
    const first = event(2, 0), second = event(3, 1, 'move');
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(2, [first]));
    clock.advance(700);
    queue.ingest(snapshot(3, [first, second]));
    assert.equal(queue.getState().currentEventId, first.id);
    assert.equal(queue.getState().pendingCount, 1);
    clock.advance(700);
    assert.equal(queue.getState().currentEventId, second.id);
    clock.advance(1400);
    assert.deepEqual(animated().map(call => call.effect.id), [first.id, second.id]);
});

test('stale versions and newly exposed older IDs cannot replay past events', () => {
    const { queue, clock, animated } = fixture();
    const old = event(1, 0), shot = event(3, 1);
    queue.ingest(snapshot(2, [old]));
    queue.ingest(snapshot(3, [old, shot]));
    queue.ingest(snapshot(2, [old, event(2, 1)]));
    queue.ingest(snapshot(4, [old, event(2, 2), shot]));
    assert.equal(queue.getState().version, 4);
    clock.advance(1400);
    assert.deepEqual(animated().map(call => call.effect.id), [shot.id]);
});

test('normal trimmed history retains overlap and new sparse projected revisions animate', () => {
    const { queue, clock, animated } = fixture();
    const history = Array.from({ length: 150 }, (_, i) => event(i + 1, i, 'end'));
    queue.ingest(snapshot(150, history));
    const shot = event(175, 150);
    queue.ingest(snapshot(175, [...history.slice(1), shot]));
    assert.deepEqual(animated().map(call => call.effect.id), [shot.id]);
    clock.advance(1400);
    assert.equal(queue.getState().lastReason, 'complete');
});

test('UUID IDs remain distinct for several events in one version at the server 150-event cap', () => {
    const { queue, clock, animated } = fixture();
    const history = Array.from({ length: 150 }, (_, i) => event(i + 1, i, 'end'));
    queue.ingest(snapshot(150, history));
    const first = event(151, 150, 'shoot', { id: 'event-151-0123456789abcdef0123456789abcdef' });
    const second = event(151, 150, 'control', { id: 'event-151-fedcba9876543210fedcba9876543210' });
    const end = event(151, 150, 'end', { id: 'event-151-abcdef0123456789abcdef0123456789' });
    const retained = [...history.slice(3), first, second, end];
    queue.ingest(snapshot(151, retained));
    queue.ingest(snapshot(151, retained.map(item => ({ ...item }))));
    clock.advance(1800);
    assert.deepEqual(animated().map(call => call.effect.id), [first.id, second.id]);
    assert.equal(clock.size, 0);
});

test('missing retained-log overlap rebases to a static projected outcome', () => {
    const { queue, clock, emitted, animated } = fixture();
    queue.ingest(snapshot(1, [event(1, 0)]));
    const latest = event(300, 150);
    queue.ingest(snapshot(300, [event(299, 149, 'end'), latest]));
    assert.equal(animated().length, 0);
    assert.deepEqual(emitted().map(call => [call.effect.id, call.animate, call.reason]), [[latest.id, false, 'history-gap']]);
    assert.equal(clock.size, 0);
    const fresh = event(301, 151);
    queue.ingest(snapshot(301, [latest, fresh]));
    assert.deepEqual(animated().map(call => call.effect.id), [fresh.id]);
    queue.dispose();
});

test('observer or battle scope invalidation cancels timers and clears old coordinates immediately', () => {
    for (const scopeKey of ['battle:player:b', 'battle:gm:', 'other-battle:player:a']) {
        const { queue, clock, animated, calls } = fixture();
        queue.ingest(snapshot(1));
        const first = event(2, 0), queued = event(3, 1);
        queue.ingest(snapshot(3, [first, queued]));
        queue.ingest(snapshot(3, [event(3, 9)], { scopeKey }));
        assert.equal(calls.at(-1).effect, null);
        assert.equal(queue.getState().pendingCount, 0);
        assert.equal(clock.size, 0);
        clock.advance(10000);
        assert.deepEqual(animated().map(call => call.effect.id), [first.id]);
        queue.dispose();
    }
});

test('offline cancels in-flight effects; reconnect consumes accumulated history statically', () => {
    const { queue, clock, animated, emitted } = fixture();
    const first = event(2, 0), second = event(3, 1), missed = event(4, 2);
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(3, [first, second]));
    queue.ingest(snapshot(3, [first, second], { online: false }));
    assert.equal(clock.size, 0);
    queue.ingest(snapshot(4, [first, second, missed], { online: true }));
    assert.equal(emitted().at(-1).effect.id, missed.id);
    assert.equal(emitted().at(-1).animate, false);
    assert.equal(emitted().at(-1).reason, 'reconnect');
    clock.advance(1000);
    const fresh = event(5, 3);
    queue.ingest(snapshot(5, [first, second, missed, fresh]));
    clock.advance(1400);
    assert.deepEqual(animated().map(call => call.effect.id), [first.id, fresh.id]);
});

test('inactive/reopen and motion toggles leave no delayed animation backlog', () => {
    const { queue, clock, animated, emitted } = fixture();
    const first = event(2, 0), second = event(3, 1), last = event(4, 2);
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(3, [first, second]));
    queue.ingest(snapshot(3, [first, second], { active: false }));
    queue.ingest(snapshot(4, [first, second, last], { active: false }));
    assert.equal(clock.size, 0);
    queue.ingest(snapshot(4, [first, second, last], { active: true }));
    assert.equal(emitted().at(-1).animate, false);
    queue.ingest(snapshot(4, [first, second, last], { reducedMotion: true }));
    queue.ingest(snapshot(4, [first, second, last], { reducedMotion: false }));
    clock.advance(1000);
    assert.deepEqual(animated().map(call => call.effect.id), [first.id]);
    assert.equal(queue.getState().currentEventId, null);
    assert.equal(clock.size, 0);
});

test('reduced motion shows the latest new confirmed outcome without timers or repeated callbacks', () => {
    const { queue, clock, emitted } = fixture();
    queue.ingest(snapshot(1, [], { reducedMotion: true }));
    const first = event(2, 0), second = event(2, 1), end = event(2, 2, 'end');
    queue.ingest(snapshot(2, [first, second, end], { reducedMotion: true }));
    queue.ingest(snapshot(2, [first, second, end], { reducedMotion: true }));
    assert.deepEqual(emitted().map(call => [call.effect.id, call.animate]), [[second.id, false]]);
    assert.equal(clock.size, 0);
});

test('a long receipt gap and a throttled callback never animate delayed history', () => {
    {
        const { queue, clock, emitted, animated } = fixture();
        queue.ingest(snapshot(1));
        clock.jump(10001);
        const latest = event(2, 0);
        queue.ingest(snapshot(2, [latest]));
        assert.equal(animated().length, 0);
        assert.equal(emitted().at(-1).reason, 'gap');
        assert.equal(clock.size, 0);
    }
    {
        const { queue, clock, emitted, animated } = fixture();
        queue.ingest(snapshot(1));
        const first = event(2, 0), last = event(3, 1);
        queue.ingest(snapshot(3, [first, last]));
        clock.jump(20000);
        clock.flushLate();
        assert.deepEqual(animated().map(call => call.effect.id), [first.id]);
        assert.equal(emitted().at(-1).effect.id, last.id);
        assert.equal(emitted().at(-1).reason, 'timer-gap');
        assert.equal(emitted().at(-1).animate, false);
        assert.equal(clock.size, 0);
    }
});

test('count and time overflow discard bounded animation backlog and use one static result', () => {
    for (const options of [{ maxPending: 1 }, { maxBacklogMs: 2000 }]) {
        const { queue, clock, emitted, animated } = fixture(options);
        queue.ingest(snapshot(1));
        const batch = [event(2, 0), event(3, 1), event(4, 2)];
        queue.ingest(snapshot(4, batch));
        assert.equal(animated().length, 0);
        assert.equal(emitted().at(-1).effect.id, batch[2].id);
        assert.equal(emitted().at(-1).reason, 'overflow');
        assert.equal(emitted().at(-1).animate, false);
        assert.equal(queue.getState().pendingCount, 0);
        assert.equal(clock.size, 0);
        queue.ingest(snapshot(4, batch));
        assert.equal(emitted().length, 1);
    }
});

test('seen-ID storage is bounded and evicted IDs at the same revision cannot replay', () => {
    const { queue, clock, animated } = fixture({ maxSeen: 2 });
    const initial = [event(1, 0), event(1, 1), event(1, 2), event(1, 3)];
    queue.ingest(snapshot(1, initial));
    for (let i = 0; i < 3; i++) queue.ingest(snapshot(1, initial));
    assert.equal(animated().length, 0);
    let previous = initial.at(-1);
    for (let version = 2; version < 50; version++) {
        const fresh = event(version, version);
        queue.ingest(snapshot(version, [previous, fresh]));
        clock.advance(1400);
        assert.ok(queue.getState().seenCount <= 2);
        previous = fresh;
    }
    assert.equal(animated().length, 48);
});

test('undo/import/prepare invalidate prior outcomes, while explicit reset starts a clean baseline', () => {
    for (const kind of ['undo', 'import', 'prepare']) {
        const { queue, clock, emitted, calls } = fixture();
        const shot = event(2, 0), reset = event(3, 1, kind);
        queue.ingest(snapshot(1));
        queue.ingest(snapshot(2, [shot]));
        queue.ingest(snapshot(3, [shot, reset]));
        assert.equal(calls.at(-1).effect, null);
        assert.equal(emitted().length, 1);
        assert.equal(clock.size, 0);
        queue.reset(snapshot(0, []));
        assert.equal(queue.getState().version, 0);
        const fresh = event(1, 0);
        queue.ingest(snapshot(1, [fresh]));
        assert.equal(emitted().at(-1).effect.id, fresh.id);
        queue.dispose();
    }
});

test('projection-only payloads stay unchanged; no hidden coordinates or synthetic outcomes are added', () => {
    const { queue, clock, emitted } = fixture();
    queue.ingest(snapshot(1));
    const redacted = Object.freeze({ id: 'event-2-0', kind: 'shoot', actorIds: ['a', 'b'], hit: false, text: 'Observed shot.' });
    const before = JSON.stringify(redacted);
    queue.ingest(snapshot(2, [redacted]));
    assert.strictEqual(emitted().at(-1).effect, redacted);
    assert.equal(JSON.stringify(redacted), before);
    assert.equal('from' in emitted().at(-1).effect, false);
    assert.equal('to' in emitted().at(-1).effect, false);
    assert.equal('damage' in emitted().at(-1).effect, false);
    clock.advance(1400);
});

test('custom supported effects and opaque actual IDs preserve ordering without character-name identity', () => {
    const { queue, clock, animated } = fixture({ isSupported: item => item.kind === 'scan', durationForEvent: () => 25 });
    const a = { id: 'server-uuid-a', kind: 'scan', text: 'Ray' }, b = { id: 'server-uuid-b', kind: 'scan', text: 'Ray' };
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(2, [a, b]));
    clock.advance(50);
    queue.ingest(snapshot(2, [a, b]));
    assert.deepEqual(animated().map(call => call.effect.id), [a.id, b.id]);
});

test('malformed records and future-ID revisions are not delivered', () => {
    const { queue, clock, animated } = fixture();
    queue.ingest(snapshot(1));
    const shot = event(2, 0);
    queue.ingest(snapshot(2, [null, {}, { id: '', kind: 'shoot' }, event(9, 0), shot]));
    clock.advance(1400);
    assert.deepEqual(animated().map(call => call.effect.id), [shot.id]);
    assert.throws(() => queue.ingest(snapshot(-1)), TypeError);
    assert.throws(() => createBattleEventQueue(), TypeError);
});

test('dispose is idempotent and prevents all later callbacks; synchronous disposal leaves no timer', () => {
    {
        const { queue, clock, calls } = fixture();
        queue.ingest(snapshot(1));
        queue.ingest(snapshot(3, [event(2, 0), event(3, 1)]));
        queue.dispose();
        const count = calls.length;
        queue.dispose();
        queue.ingest(snapshot(4, [event(4, 0)]));
        queue.reset(snapshot(0));
        clock.advance(20000);
        assert.equal(calls.length, count);
        assert.equal(clock.size, 0);
        assert.equal(queue.getState().seenCount, 0);
    }
    {
        const clock = fakeClock();
        let queue;
        queue = createBattleEventQueue({ clock, onEffect: effect => { if (effect) queue.dispose(); } });
        queue.ingest(snapshot(1));
        queue.ingest(snapshot(2, [event(2, 0)]));
        assert.equal(clock.size, 0);
        assert.equal(queue.getState().disposed, true);
    }
});

test('stale lifecycle invalidation still cancels animation without lowering the revision fence', () => {
    const { queue, clock } = fixture();
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(3, [event(2, 0), event(3, 1)]));
    queue.ingest(snapshot(2, [event(2, 0)], { active: false }));
    assert.equal(clock.size, 0);
    assert.equal(queue.getState().version, 3);
    assert.equal(queue.getState().currentEventId, null);
});

test('same-observer current removal at the same or newer revision immediately revokes its timer', () => {
    for (const version of [3, 4]) {
        const { queue, clock, calls, animated } = fixture();
        const anchor = event(1, 0, 'end'), first = event(2, 1), second = event(3, 2);
        queue.ingest(snapshot(1, [anchor]));
        queue.ingest(snapshot(3, [anchor, first, second]));
        clock.advance(100);
        const before = calls.length;
        queue.ingest(snapshot(version, [anchor, second]));
        assert.equal(calls[before].effect, null);
        assert.equal(calls[before].reason, 'projection');
        assert.equal(queue.getState().currentEventId, second.id);
        assert.equal(clock.size, 1);
        clock.advance(5000);
        assert.deepEqual(animated().map(call => call.effect.id), [first.id, second.id]);
        assert.equal(calls.slice(before).some(call => call.effect?.id === first.id), false);
        assert.equal(clock.size, 0);
    }
});

test('same-observer queued removal at the same or newer revision cannot be restored after current completes', () => {
    for (const version of [3, 4]) {
        const { queue, clock, animated } = fixture();
        const anchor = event(1, 0, 'end'), first = event(2, 1), removed = event(3, 2);
        queue.ingest(snapshot(1, [anchor]));
        queue.ingest(snapshot(3, [anchor, first, removed]));
        queue.ingest(snapshot(version, [anchor, first]));
        assert.equal(queue.getState().pendingCount, 0);
        clock.advance(5000);
        assert.deepEqual(animated().map(call => call.effect.id), [first.id]);
        assert.equal(clock.size, 0);
        // Reappearing consumed IDs are history, not new animation requests.
        queue.ingest(snapshot(version, [anchor, first, removed]));
        assert.equal(animated().length, 1);
    }
});

test('same/new-version current redaction emits only its latest static copy and cancels old coordinates', () => {
    for (const version of [2, 3]) {
        const { queue, clock, calls, emitted } = fixture();
        const anchor = event(1, 0, 'end'), first = event(2, 1);
        queue.ingest(snapshot(1, [anchor]));
        queue.ingest(snapshot(2, [anchor, first]));
        clock.advance(50);
        const redacted = { id: first.id, kind: 'shoot', hit: true, damage: 5, actorIds: ['a', 'b'] };
        const before = calls.length;
        queue.ingest(snapshot(version, [anchor, redacted]));
        assert.equal(calls[before].effect, null);
        assert.strictEqual(emitted().at(-1).effect, redacted);
        assert.equal(emitted().at(-1).animate, false);
        assert.equal(emitted().at(-1).reason, 'projection');
        assert.equal(clock.size, 0);
        clock.advance(5000);
        for (const call of calls.slice(before).filter(call => call.effect)) {
            assert.equal('from' in call.effect, false);
            assert.equal('to' in call.effect, false);
        }
        const callbackCount = calls.length;
        queue.ingest(snapshot(version, [anchor, { ...redacted }]));
        assert.equal(calls.length, callbackCount);
    }
});

test('same/new-version pending redaction replaces queued payload before its eventual callback', () => {
    for (const version of [3, 4]) {
        const { queue, clock, animated } = fixture();
        const anchor = event(1, 0, 'end'), first = event(2, 1), pending = event(3, 2);
        queue.ingest(snapshot(1, [anchor]));
        queue.ingest(snapshot(3, [anchor, first, pending]));
        const redacted = { id: pending.id, kind: 'shoot', hit: false, actorIds: ['a', 'b'] };
        queue.ingest(snapshot(version, [anchor, { ...first }, redacted]));
        clock.advance(1400);
        assert.strictEqual(animated().at(-1).effect, redacted);
        assert.equal('from' in animated().at(-1).effect, false);
        assert.equal('to' in animated().at(-1).effect, false);
        clock.advance(1400);
        assert.equal(animated().length, 2);
        assert.equal(clock.size, 0);
    }
});

test('revoking all live effects while retaining an unrelated log anchor clears current and pending work', () => {
    const { queue, clock, calls } = fixture();
    const anchor = event(1, 0, 'end');
    queue.ingest(snapshot(1, [anchor]));
    queue.ingest(snapshot(3, [anchor, event(2, 1), event(3, 2)]));
    queue.ingest(snapshot(3, [anchor]));
    assert.equal(calls.at(-1).effect, null);
    assert.equal(queue.getState().pendingCount, 0);
    assert.equal(clock.size, 0);
    const count = calls.length;
    clock.advance(20000);
    assert.equal(calls.length, count);
});

test('temporarily empty same-scope projections do not replay consumed IDs when they reappear', () => {
    const { queue, clock, animated } = fixture();
    const shot = event(2, 0);
    queue.ingest(snapshot(1));
    queue.ingest(snapshot(2, [shot]));
    queue.ingest(snapshot(2, []));
    assert.equal(clock.size, 0);
    queue.ingest(snapshot(2, [{ ...shot }]));
    clock.advance(5000);
    assert.deepEqual(animated().map(call => call.effect.id), [shot.id]);
    assert.equal(clock.size, 0);
});

test('foundation events deliver per-target traces without replaying aggregate damage',()=>{
 const f=fixture();f.queue.ingest(snapshot(0,[]));
 const first=event(1,1,'shoot',{visualOnly:true}),second=event(1,2,'shoot',{visualOnly:true,actorIds:['a','c']}),summary=event(1,3,'shoot',{effectSuppressed:true});
 f.queue.ingest(snapshot(1,[first,second,summary]));f.clock.advance(2800);
 assert.deepEqual(f.emitted().map(row=>row.effect.id),[first.id,second.id]);
 const melee=event(2,1,'melee'),swap=event(2,2,'switch'),jam=event(2,3,'unjam');
 f.queue.ingest(snapshot(2,[first,second,summary,melee,swap,jam]));f.clock.advance(2000);
 assert.deepEqual(f.emitted().slice(-3).map(row=>row.effect.kind),['melee','switch','unjam']);f.queue.dispose();
});
