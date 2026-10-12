export type LoadingVariant = 'channel' | 'stream' | 'signature';
export type LoadingPhase = 'sync' | 'read' | 'verify' | 'waiting' | 'ready' | 'error';
export type LoadingPlan = {
  rhythm: string;
  total: number;
  durations: [number, number, number];
  ends: [number, number, number];
  points: {time: number; value: number}[];
  tangents: number[];
};

/** Approved preview rhythms. A shuffle bag prevents adjacent repeats, including across bags. */
export const LOADING_RHYTHMS = [
  {id: 'steady', pace: [1, 1, 1], weights: [1, 1, 1, 1, 1, 1, 1, 1]},
  {id: 'inertia', pace: [1.12, 1, .92], weights: [.3, .45, .65, .9, 1.3, 1.6, 2, 1.7]},
  {id: 'capture', pace: [.9, 1.04, 1.12], weights: [2.3, 1.9, 1.5, 1, .65, .55, .75, 1.1]},
  {id: 'waves', pace: [1, 1.08, .92], weights: [.6, 1.8, .75, .4, 1.65, .8, .45, 1.4]},
  {id: 'tail', pace: [.94, .96, 1.35], weights: [1.8, 1.6, 1.4, 1.2, .9, .65, .4, .3]},
  {id: 'gates', pace: [1, 1.12, .94], weights: [1.4, 1.3, .06, 1.7, 1.4, .08, 1.5, 1.1]},
  {id: 'middle', pace: [.92, 1.2, .9], weights: [1.6, 1.4, .75, .3, .35, .65, 1.5, 1.7]},
  {id: 'chase', pace: [1.1, 1.04, .92], weights: [.45, .6, .55, .7, .6, 1.3, 2.1, 2.5]},
] as const;

/** The injected random source makes duration, ordering and interpolation independently testable. */
export function createLoadingRhythmGenerator(random: () => number = Math.random) {
  let bag: number[] = [], last = -1;
  return (): LoadingPlan => {
    if (!bag.length) {
      bag = LOADING_RHYTHMS.map((_, index) => index);
      for (let index = bag.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [bag[index], bag[other]] = [bag[other], bag[index]];
      }
      if (bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    last = bag.pop()!;
    const rhythm = LOADING_RHYTHMS[last], total = Math.round(4600 + random() * 1100);
    const budgets = [1300, 2300, 1100].map((base, index) => base * rhythm.pace[index] * (.92 + random() * .16));
    const sum = budgets.reduce((a, b) => a + b, 0);
    const durations = budgets.map(budget => Math.round(budget / sum * total)) as LoadingPlan['durations'];
    durations[2] = total - durations[0] - durations[1];
    const ends: LoadingPlan['ends'] = [durations[0], durations[0] + durations[1], total];
    const points = [{time: 0, value: 0}], targets = [0, .22, .88, 1];
    durations.forEach((duration, index) => {
      const start = index ? ends[index - 1] : 0;
      const weights = rhythm.weights.map(weight => weight * (.76 + random() * .48));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      let gathered = 0;
      weights.forEach((weight, part) => {
        gathered += weight;
        const localTime = part === 7 ? 1 : (part + 1) / 8 + (random() - .5) * .055;
        points.push({time: start + duration * localTime, value: targets[index] + (targets[index + 1] - targets[index]) * gathered / weightSum});
      });
    });
    // Monotone cubic Hermite interpolation: continuous velocity without overshoot or reversal.
    const slopes = points.slice(1).map((point, index) => (point.value - points[index].value) / (point.time - points[index].time));
    const tangents = points.map((point, index) => {
      if (index === 0 || index === points.length - 1) return 0;
      const before = point.time - points[index - 1].time, after = points[index + 1].time - point.time;
      return 3 * (before + after) / ((2 * after + before) / slopes[index - 1] + (after + 2 * before) / slopes[index]);
    });
    slopes.forEach((slope, index) => {
      const a = tangents[index] / slope, b = tangents[index + 1] / slope, length = Math.hypot(a, b);
      if (length > 3) {
        tangents[index] = a * 3 / length * slope;
        tangents[index + 1] = b * 3 / length * slope;
      }
    });
    return {rhythm: rhythm.id, total, durations, ends, points, tangents};
  };
}

export const nextLoadingPlan = createLoadingRhythmGenerator();

export function sampleLoadingProgress(plan: LoadingPlan, time: number) {
  if (time <= 0) return 0;
  if (time >= plan.total) return 1;
  const index = plan.points.findIndex(point => point.time > time) - 1;
  const a = plan.points[index], b = plan.points[index + 1], span = b.time - a.time;
  const t = (time - a.time) / span, t2 = t * t, t3 = t2 * t;
  const value = (2 * t3 - 3 * t2 + 1) * a.value + (t3 - 2 * t2 + t) * span * plan.tangents[index]
    + (-2 * t3 + 3 * t2) * b.value + (t3 - t2) * span * plan.tangents[index + 1];
  return Math.min(b.value, Math.max(a.value, value));
}

/** Decorative completion never authorizes access or claims a completed API request. */
export function getLoadingState(plan: LoadingPlan, elapsed: number, actualReady: boolean, bypassMotion: boolean, error?: string) {
  const visualDone = bypassMotion || elapsed >= plan.total;
  const complete = actualReady && visualDone && !error;
  let phase: LoadingPhase = 'sync';
  if (error) phase = 'error';
  else if (complete) phase = 'ready';
  else if (visualDone) phase = 'waiting';
  else if (elapsed >= plan.ends[1]) phase = 'verify';
  else if (elapsed >= plan.ends[0]) phase = 'read';
  const progress = complete ? 1 : Math.min(actualReady ? .999 : .96, sampleLoadingProgress(plan, elapsed));
  return {phase, complete, visualDone, progress};
}
