const MAX_SEGMENTS_PER_ADVANCE = 1000;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

function validDistance(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 消费一段纯数据路程，不触发地图渲染或道路状态副作用。
 * segmentLength 可按相邻节点返回下一段长度；未提供时沿用当前 totalPx。
 */
export function advanceGpsDistance(distance, gpsState, { segmentLength, nextRoute } = {}) {
  const state = clone(gpsState || {});
  let remaining = validDistance(distance);
  let consumed = 0;
  let guard = 0;
  const lengthOf = (a, b, fallback) => {
    const length = typeof segmentLength === 'function' ? segmentLength(a, b) : fallback;
    return validDistance(length);
  };

  while (remaining > 0 && guard++ < MAX_SEGMENTS_PER_ADVANCE) {
    const path = state.path;
    const seg = Number.isInteger(state.seg) ? state.seg : 0;
    if (!Array.isArray(path) || path.length < 2 || seg < 0 || seg >= path.length - 1) break;
    const total = validDistance(state.totalPx) || lengthOf(path[seg], path[seg + 1], 0);
    const rawRemain = typeof state.remainPx === 'number' && Number.isFinite(state.remainPx) && state.remainPx >= 0
      ? state.remainPx
      : total;
    const remainPx = Math.max(0, Math.min(rawRemain, total));
    if (total <= 0 || remainPx <= 0) {
      const arrived = path[seg + 1];
      if (seg < path.length - 2) {
        state.seg = seg + 1;
        state.curIdx = arrived;
        state.totalPx = lengthOf(path[state.seg], path[state.seg + 1], total);
        state.remainPx = state.totalPx;
        state.units = state.totalPx;
        continue;
      }
      const continued = state.roamEnabled && typeof nextRoute === 'function'
        ? nextRoute(arrived, state)
        : null;
      if (continued?.path?.length >= 2) {
        Object.assign(state, clone(continued));
        continue;
      } else {
        state.curIdx = arrived;
        state.destIdx = null;
        state.path = null;
        state.seg = 0;
        state.units = 0;
        state.totalPx = 0;
        state.remainPx = 0;
      }
      break;
    }
    const used = Math.min(remaining, remainPx);
    state.remainPx = remainPx - used;
    remaining -= used;
    consumed += used;
    if (state.remainPx > 0) break;
  }
  return { state, consumed, remaining };
}
