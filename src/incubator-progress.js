function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function settleIncubatorProgress(gameData, { hatchMultiplier = 1, walkDistance } = {}) {
  const next = clone(gameData || {});
  const distance = finite(walkDistance, finite(next.stats?.walkDistance));
  const multiplier = finite(hatchMultiplier, 1) > 0 ? finite(hatchMultiplier, 1) : 1;
  let changed = false;
  let hatched = 0;
  for (const slot of next.incubators || []) {
    if (!slot || slot.eggIndex == null || slot.hatched) continue;
    const used = distance - finite(slot.hatchStart);
    const need = finite(slot.hatchDuration) * multiplier;
    if (!Number.isFinite(used) || used < 0 || used + 100 >= need) {
      slot.hatched = true;
      changed = true;
      hatched += 1;
    }
  }
  return { gameData: next, changed, hatched };
}
