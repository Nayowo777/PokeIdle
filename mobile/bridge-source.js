import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { calculateMobileLayout } from './viewport-utils.mjs';
import { createBackgroundMode } from './background-mode.mjs';

let saveQueue = Promise.resolve();
const NativeSave = registerPlugin('PokeIdleSave');
const backgroundMode = createBackgroundMode({ capacitor: Capacitor });

const mobileBridge = {
  isMobile: true,

  async loadGameData() {
    return NativeSave.loadGameData();
  },

  saveGameData(data) {
    const operation = saveQueue.catch(() => {}).then(() => NativeSave.saveGameData({ data }));
    saveQueue = operation;
    return operation;
  },

  async pickImportFile() {
    const result = await NativeSave.pickImportFile();
    return result?.cancelled ? null : result;
  },

  async exportSaveData(data, fileName) {
    const result = await NativeSave.exportSaveData({ data, fileName });
    return result?.cancelled ? null : result;
  },

  createImportBackup(data) {
    return NativeSave.createImportBackup({ data });
  },

  async loadImportBackup() {
    const result = await NativeSave.loadImportBackup();
    return result?.data ?? null;
  },

  async selectSharedSaveDirectory() {
    const result = await NativeSave.selectSharedSaveDirectory();
    return result?.cancelled ? null : result;
  },

  async readSharedSaveData() {
    return NativeSave.readSharedSaveData();
  },

  writeSharedSaveData(data, fileName = 'pokeidle-save.json') {
    const operation = saveQueue.catch(() => {}).then(() => NativeSave.writeSharedSaveData({ data, fileName }));
    saveQueue = operation;
    return operation;
  },

  async getAppVersion() {
    return (await App.getInfo()).version;
  },

  startBackgroundMode: () => backgroundMode.startBackgroundMode(),
  stopBackgroundMode: () => backgroundMode.stopBackgroundMode(),
  isBackgroundModeSupported: () => backgroundMode.isBackgroundModeSupported(),
  onBackgroundTick: callback => backgroundMode.onBackgroundTick(callback),
  onBackgroundStopped: callback => backgroundMode.onBackgroundStopped(callback),

  openExternal(url) {
    return Browser.open({ url });
  },

  exitApp() {
    return App.exitApp();
  },
};

window.__POKEIDLE_MOBILE__ = mobileBridge;
window.__POKEIDLE_MOBILE_RELOAD__ = () => {
  try {
    window.location.reload();
  } catch (_) {
    return App.exitApp();
  }
};
document.documentElement.classList.add('mobile-mode');

function syncMobileViewport() {
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const insets = bodyStyle ? {
    top: parseFloat(bodyStyle.paddingTop) || 0,
    right: parseFloat(bodyStyle.paddingRight) || 0,
    bottom: parseFloat(bodyStyle.paddingBottom) || 0,
    left: parseFloat(bodyStyle.paddingLeft) || 0,
  } : {};
  const { scale, designHeight } = calculateMobileLayout(width, height, insets);
  const root = document.documentElement;
  root.style.setProperty('--mobile-scale', String(scale));
  root.style.setProperty('--mobile-layout-height', `${designHeight}px`);
  window.__POKEIDLE_INVALIDATE_STAGE_SIZE__?.();
}

function enableMobileLayout() {
  document.body?.classList.add('mobile-mode');
  syncMobileViewport();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enableMobileLayout, { once: true });
else enableMobileLayout();
window.addEventListener('resize', syncMobileViewport);
window.visualViewport?.addEventListener('resize', syncMobileViewport);

let handlingBack = false;
App.addListener('backButton', async () => {
  if (handlingBack) return;
  handlingBack = true;
  try {
    await window.__POKEIDLE_MOBILE_BACK__?.();
  } finally {
    handlingBack = false;
  }
});

App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) {
    Promise.resolve(window.__POKEIDLE_BACKGROUND_RESUME__?.())
      .catch(() => {})
      .finally(() => backgroundMode.stopBackgroundMode().catch?.(() => {}));
    window.__POKEIDLE_AUDIO_RESUME__?.();
    Promise.resolve(window.__POKEIDLE_SHARED_SAVE_CHECK__?.()).catch(() => {});
  } else {
    Promise.resolve(window.__POKEIDLE_BACKGROUND_ENTER__?.())
      .then(started => {
        if (started !== false) return backgroundMode.startBackgroundMode();
        return null;
      })
      .catch(() => {});
    window.__POKEIDLE_SAVE_NOW__?.();
  }
});

App.addListener('pause', () => window.__POKEIDLE_SAVE_NOW__?.());

backgroundMode.onBackgroundTick(({ now }) => {
  Promise.resolve(window.__POKEIDLE_BACKGROUND_TICK__?.(now)).catch(() => {});
});

backgroundMode.onBackgroundStopped(() => {
  Promise.resolve(window.__POKEIDLE_BACKGROUND_STOPPED__?.()).catch(() => {});
});
