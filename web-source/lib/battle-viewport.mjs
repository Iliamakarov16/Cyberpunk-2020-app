/** Visible layout viewport, including the space left above a software keyboard. */
export function battleViewport(win) {
  const v = win?.visualViewport;
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  return {
    width: positive(v?.width, positive(win?.innerWidth, 1024)),
    height: positive(v?.height, positive(win?.innerHeight, 768)),
    top: Number.isFinite(v?.offsetTop) ? Math.max(0, v.offsetTop) : 0,
    left: Number.isFinite(v?.offsetLeft) ? Math.max(0, v.offsetLeft) : 0,
  };
}

export function observeBattleViewport(win, update) {
  const refresh = () => update(battleViewport(win));
  refresh();
  win.addEventListener('resize', refresh);
  win.visualViewport?.addEventListener('resize', refresh);
  win.visualViewport?.addEventListener('scroll', refresh);
  return () => {
    win.removeEventListener('resize', refresh);
    win.visualViewport?.removeEventListener('resize', refresh);
    win.visualViewport?.removeEventListener('scroll', refresh);
  };
}
