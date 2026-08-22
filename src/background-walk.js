function copyValue(value) {
  if (Array.isArray(value)) return value.map(copyValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyValue(item)]));
  }
  return value;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * 在后台时间片内结算普通步行路程。
 * 该函数只处理存档数据，不触碰道路动画、GPS DOM 或孵蛋界面。
 */
export function settleBackgroundWalk({ state, from, to } = {}) {
  const next = copyValue(state || {});
  const elapsed = Number.isFinite(from) && Number.isFinite(to) && to > from ? to - from : 0;
  const speed = finiteNonNegative(next.walkPxPerSecond);
  const distance = next.walkingEnabled === true ? (elapsed / 1000) * speed : 0;
  if (distance <= 0 || !next.gameData) return { state: next, distance: 0, hatched: 0 };

  next.gameData.stats ||= {};
  next.gameData.background ||= {};
  next.gameData.background.stats ||= {};
  next.gameData.stats.walkDistance = finiteNonNegative(next.gameData.stats.walkDistance) + distance;
  next.gameData.background.stats.walkDistance = finiteNonNegative(next.gameData.background.stats.walkDistance) + distance;
  return { state: next, distance, hatched: 0 };
}
