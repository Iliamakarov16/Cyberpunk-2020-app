/**
 * Delivery of already audience-filtered battle events to the single-effect renderer.
 *
 * const queue = createBattleEventQueue({
 *   onEffect: (event, { animate }) => setEffect(event && { ...event, static: !animate }),
 * });
 * queue.ingest({ scopeKey: `${scene.id}:${role}:${observerId}`, version: scene.version,
 *   log: scene.log, active, online, reducedMotion });
 * // Pass visibility/lifecycle changes immediately, even without a new revision.
 * // Call dispose on unmount. A new queue or reset(snapshot) starts at a baseline.
 *
 * Initial history and a changed scope are never replayed. Normal connected updates
 * preserve supported events in projected log order, including several events in one
 * version. Non-effects such as `end` cannot overwrite a pending shot. Event identity
 * is the server ID, never a character name; event-N-suffix IDs also provide a revision
 * fence. Sparse projected revisions are normal and do not alone establish a gap.
 *
 * Reconnect, reactivation, a long delivery gap, missing retained-log overlap, or
 * bounded-queue overflow deliberately discard animation history and show only the
 * latest supported projected event statically. This is not a complete replay API:
 * the server retains just 150 events and this utility never reconstructs missing
 * events, coordinates, actors, or permissions. Undo/prepare/import invalidate prior
 * effects. The caller must change scopeKey with scene, role, or observer identity.
 * Every accepted projection also revokes missing current/queued IDs and refreshes
 * retained payloads. A changed current payload becomes static immediately, so a
 * redacted coordinate can never be restored by a later delivery callback. Renderer
 * consumers must replace same-ID payloads too, rather than caching old geometry.
 *
 * Reduced motion delivers only the latest new supported event with animate:false;
 * there are no delivery timers in that mode. Re-enabling motion consumes a baseline
 * rather than animating accumulated history. Metadata must gate both motion and
 * sound, including static fallbacks while the app otherwise permits motion.
 *
 * Inject clock { now, setTimeout, clearTimeout } for deterministic tests. onEffect
 * receives a read-only original projected event (or null) and {animate, reason}.
 * Durations are bounded to 1..5000ms; memory is capped by maxSeen IDs and maxPending
 * pending effects, with at most one effect currently displayed and one timer.
 */

export const BATTLE_EFFECT_KINDS = Object.freeze(['shoot', 'move', 'face', 'reload', 'door', 'control','melee','switch','unjam','flip']);
const EFFECT_KINDS = new Set(BATTLE_EFFECT_KINDS);
const RESET_KINDS = new Set(['undo', 'prepare', 'import']);

export function battleEventVersion(event) {
    // Current server IDs use UUID hex; persisted older logs used decimal offsets.
    const match = typeof event?.id === 'string' && /^event-(\d+)-(?:\d+|[0-9a-f]{32})$/i.exec(event.id);
    if (!match) return null;
    const version = Number(match[1]);
    return Number.isSafeInteger(version) ? version : null;
}

export function battleEventDuration(event) {
    return event.kind === 'shoot' || event.kind === 'move' ? 1400 : event.kind === 'flip' ? 600 : event.kind === 'melee' ? 700 : event.kind === 'face' ? 220 : 400;
}

function boundedOption(value, fallback, min, max) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

export function createBattleEventQueue({
    onEffect,
    isSupported = event => EFFECT_KINDS.has(event.kind)&&!event.effectSuppressed,
    durationForEvent = battleEventDuration,
    clock = {},
    maxPending = 8,
    maxSeen = 256,
    maxBacklogMs = 8000,
    reconnectAfterMs = 10000,
} = {}) {
    if (typeof onEffect !== 'function') throw new TypeError('onEffect is required');
    const now = clock.now ? () => clock.now() : () => globalThis.performance?.now() ?? Date.now();
    const schedule = clock.setTimeout ? (fn, ms) => clock.setTimeout(fn, ms) : (fn, ms) => globalThis.setTimeout(fn, ms);
    const cancel = clock.clearTimeout ? id => clock.clearTimeout(id) : id => globalThis.clearTimeout(id);
    const pendingLimit = boundedOption(maxPending, 8, 1, 64);
    const seenLimit = boundedOption(maxSeen, 256, 1, 1024);
    const backlogLimit = boundedOption(maxBacklogMs, 8000, 1, 60000);
    const gapLimit = boundedOption(reconnectAfterMs, 10000, 1, 300000);
    const seen = new Set();
    let context = null, lastAt = 0, lastLogCount = 0, pending = [], current = null;
    let timer = null, generation = 0, disposed = false, lastReason = 'new';

    function emit(event, animate, reason) {
        lastReason = reason;
        onEffect(event, { animate, reason });
    }

    function clear(reason) {
        generation++;
        if (timer !== null) cancel(timer);
        timer = null;
        current = null;
        pending = [];
        emit(null, false, reason);
    }

    function snapshot(input) {
        if (typeof input?.scopeKey !== 'string' || !Number.isSafeInteger(input.version) || input.version < 0 || !Array.isArray(input.log)) {
            throw new TypeError('A string scopeKey, nonnegative integer version, and projected log array are required');
        }
        const log = input.log.filter(event => {
            if (!event || typeof event.id !== 'string' || !event.id) return false;
            const revision = battleEventVersion(event);
            return revision === null || revision <= input.version;
        });
        return { scopeKey: input.scopeKey, version: input.version, log,
            active: input.active !== false, online: input.online !== false, reducedMotion: input.reducedMotion === true };
    }

    function remember(next) {
        for (const event of next.log) {
            // Refresh the retained window so duplicate polls do not evict its tail.
            seen.delete(event.id);
            seen.add(event.id);
            if (seen.size > seenLimit) seen.delete(seen.values().next().value);
        }
        context = { scopeKey: next.scopeKey, version: next.version, active: next.active,
            online: next.online, reducedMotion: next.reducedMotion };
        lastAt = now();
        lastLogCount = next.log.length;
    }

    function latestSupported(log) {
        // Do not show a result that was undone or belongs to replaced preparation.
        for (let i = log.length - 1; i >= 0; i--) {
            if (RESET_KINDS.has(log[i].kind)) return null;
            if (isSupported(log[i])) return log[i];
        }
        return null;
    }

    function showStatic(event, reason) {
        if (!event || disposed) return;
        current = { event, animate: false, duration: 0, startedAt: now() };
        emit(event, false, reason);
    }

    function reconcileProjection(log) {
        const projected = new Map(log.map(event => [event.id, event]));
        pending = pending.flatMap(item => {
            const latest = projected.get(item.event.id);
            return latest && isSupported(latest) ? [{ ...item, event: latest }] : [];
        });
        if (!current) return;
        const latest = projected.get(current.event.id);
        if (latest && isSupported(latest) && JSON.stringify(latest) === JSON.stringify(current.event)) {
            current.event = latest;
            return;
        }
        // Keep other still-projected queued effects, but cancel the old payload's
        // timer before clearing it. Delayed callbacks cannot resurrect its fields.
        generation++;
        if (timer !== null) cancel(timer);
        timer = null;
        current = null;
        emit(null, false, 'projection');
        if (latest && isSupported(latest)) showStatic(latest, 'projection');
    }

    function baseline(next, reason, showOutcome = false) {
        clear(reason);
        // Keep same-scope IDs across temporary empty/revoked projections, so an
        // event reappearing in the same revision is not mistaken for a new action.
        if (!context || context.scopeKey !== next.scopeKey || reason === 'reset') seen.clear();
        remember(next);
        if (showOutcome && next.active && next.online) showStatic(latestSupported(next.log), reason);
    }

    function pump() {
        if (disposed || current?.animate || !pending.length) return;
        const item = pending.shift(), token = generation;
        current = { ...item, animate: true, startedAt: now() };
        emit(item.event, true, 'event');
        // A callback may synchronously dispose, reset, or change observer.
        if (disposed || token !== generation || current?.event.id !== item.event.id) return;
        timer = schedule(() => {
            if (disposed || token !== generation) return;
            timer = null;
            if (now() - current.startedAt > item.duration + gapLimit) {
                const latest = pending.at(-1)?.event || current.event;
                clear('timer-gap');
                showStatic(latest, 'timer-gap');
                return;
            }
            current = null;
            if (pending.length) pump();
            else emit(null, false, 'complete');
        }, item.duration);
    }

    function getState() {
        return { disposed, initialized: context !== null, scopeKey: context?.scopeKey ?? null,
            version: context?.version ?? null, pendingCount: pending.length, seenCount: seen.size,
            currentEventId: current?.event.id ?? null, animating: current?.animate === true,
            hasTimer: timer !== null, lastReason };
    }

    function ingest(input) {
        if (disposed) return getState();
        const next = snapshot(input);
        if (!context || next.scopeKey !== context.scopeKey) {
            baseline(next, context ? 'scope' : 'initial');
            return getState();
        }
        // Late HTTP responses never move the revision fence backwards. Lifecycle
        // invalidation still wins if a stale response arrives after closing/offline.
        if (next.version < context.version) {
            if (!next.active || !next.online) {
                clear(!next.active ? 'inactive' : 'offline');
                context = { ...context, active: next.active, online: next.online };
            }
            return getState();
        }
        if (!next.active || !next.online) {
            const reason = !next.active ? 'inactive' : 'offline';
            if (current || pending.length || context.active !== next.active || context.online !== next.online) clear(reason);
            remember(next);
            return getState();
        }
        if (!context.active || !context.online) {
            baseline(next, !context.online ? 'reconnect' : 'reactivate', true);
            return getState();
        }
        if (now() - lastAt > gapLimit) {
            baseline(next, 'gap', true);
            return getState();
        }
        if (next.reducedMotion !== context.reducedMotion) {
            baseline(next, 'motion', next.reducedMotion);
            return getState();
        }

        let lastKnownIndex = -1;
        for (let i = 0; i < next.log.length; i++) if (seen.has(next.log[i].id)) lastKnownIndex = i;
        if (lastLogCount && lastKnownIndex < 0) {
            baseline(next, 'history-gap', true);
            return getState();
        }
        const batchIds = new Set(), added = [];
        for (let i = 0; i < next.log.length; i++) {
            const event = next.log[i], revision = battleEventVersion(event);
            if (seen.has(event.id) || batchIds.has(event.id)) continue;
            batchIds.add(event.id);
            if (revision !== null ? revision < context.version || (revision === context.version && i <= lastKnownIndex) : i <= lastKnownIndex) continue;
            added.push(event);
        }
        if (added.some(event => RESET_KINDS.has(event.kind))) {
            baseline(next, 'reset', true);
            return getState();
        }
        remember(next);
        reconcileProjection(next.log);
        if (disposed) return getState();
        const effects = added.filter(isSupported);
        if (!effects.length) {
            if (!next.reducedMotion) pump();
            return getState();
        }
        if (next.reducedMotion) {
            clear('reduced-motion');
            showStatic(effects.at(-1), 'reduced-motion');
            return getState();
        }
        const incoming = effects.map(event => ({ event, duration: boundedOption(durationForEvent(event), 1400, 1, 5000) }));
        const remaining = current?.animate ? Math.max(0, current.duration - (now() - current.startedAt)) : 0;
        const totalDuration = [...pending, ...incoming].reduce((sum, item) => sum + item.duration, remaining);
        // maxPending excludes the one effect that can start immediately if idle.
        const waitingCount = pending.length + incoming.length - (current?.animate ? 0 : 1);
        if (waitingCount > pendingLimit || totalDuration > backlogLimit) {
            clear('overflow');
            showStatic(effects.at(-1), 'overflow');
            return getState();
        }
        pending.push(...incoming);
        pump();
        return getState();
    }

    return {
        ingest,
        reset(input) { if (!disposed) baseline(snapshot(input), 'reset'); return getState(); },
        getState,
        dispose() {
            if (disposed) return;
            disposed = true;
            clear('dispose');
            seen.clear();
            context = null;
        },
    };
}
