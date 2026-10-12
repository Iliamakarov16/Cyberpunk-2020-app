/** One version for the web client, its API and the packaged Android screen. */
export const APP_VERSION = '0.17.7';
export const API_VERSION = 1;

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const next = parse(candidate), installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}
