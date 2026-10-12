export type CheckInput = {
  stat: number;
  rank: number;
  modifier: number;
  difficulty?: number | null;
};

export type CheckResult = {
  stat: number;
  rank: number;
  modifier: number;
  difficulty: number | null;
  natural: number;
  bonus: number | null;
  fumble: number | null;
  total: number;
  outcome: 'success' | 'failure' | 'pending' | 'fumble';
};

function die(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError('На d10 должно быть целое число от 1 до 10.');
  }
  return value;
}

/** Rejection sampling: all ten faces have the same number of uint32 values. */
export function rollD10(nextUint32: () => number = () => {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return value[0];
}): number {
  const acceptedRange = 4_294_967_290; // floor(2^32 / 10) * 10
  let value: number;
  do {
    value = nextUint32();
    if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
      throw new RangeError('Источник случайных чисел должен возвращать uint32.');
    }
  } while (value >= acceptedRange);
  return value % 10 + 1;
}

/** Cyberpunk 2020 Core, pp. 41–43: natural 1 fails; natural 10 adds one d10. */
export function resolveSkillCheck(input: CheckInput, natural: number, extra?: number): CheckResult {
  die(natural);
  if (![input.stat, input.rank, input.modifier].every(Number.isSafeInteger) || input.rank < 0) {
    throw new RangeError('STAT, ранг и модификатор должны быть целыми числами; ранг не может быть отрицательным.');
  }
  const difficulty = input.difficulty ?? null;
  if (difficulty !== null && (!Number.isSafeInteger(difficulty) || difficulty < 1)) {
    throw new RangeError('Сложность должна быть целым положительным числом.');
  }
  const needsExtra = natural === 1 || natural === 10;
  if (needsExtra && extra === undefined) throw new RangeError('Для 1 или 10 нужен ещё один d10.');
  if (extra !== undefined) {
    die(extra);
    if (!needsExtra) throw new RangeError('Дополнительный d10 нужен только после 1 или 10.');
  }
  const bonus = natural === 10 ? extra! : null;
  const fumble = natural === 1 ? extra! : null;
  const total = input.stat + input.rank + input.modifier + natural + (bonus ?? 0);
  const outcome = fumble !== null ? 'fumble' : difficulty === null ? 'pending' : total >= difficulty ? 'success' : 'failure';
  return { ...input, difficulty, natural, bonus, fumble, total, outcome };
}

/** The second roll is consumed once, including when that second roll is 10. */
export function rollSkillCheck(input: CheckInput, draw: () => number = rollD10): CheckResult {
  const natural = die(draw());
  return resolveSkillCheck(input, natural, natural === 1 || natural === 10 ? die(draw()) : undefined);
}
