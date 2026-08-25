import {
  parseSaveTransfer,
  prepareImportedSave,
  serializeSaveForExport,
  summarizeSave,
} from './save-transfer.js';
import { createSavePlatform } from './save-platform.js';

const clone = value => JSON.parse(JSON.stringify(value));

async function applyAndPersist({ original, replacement, apply, persist }) {
  apply(replacement);
  try {
    await persist();
  } catch (error) {
    apply(original);
    try {
      await persist();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
  return replacement;
}

export async function replaceSaveWithBackup({
  getCurrent,
  incoming,
  saveCurrent,
  createBackup,
  apply,
  persist,
  now = Date.now(),
}) {
  await saveCurrent();
  const original = clone(getCurrent());
  await createBackup(JSON.stringify(original));
  const replacement = prepareImportedSave(incoming, { currentSave: original, now });
  return applyAndPersist({ original, replacement, apply, persist });
}

export async function restoreBackupSave({ getCurrent, backupData, apply, persist }) {
  const original = clone(getCurrent());
  const replacement = clone(backupData);
  return applyAndPersist({ original, replacement, apply, persist });
}

export function formatSaveTransferError(error) {
  const code = error?.code || String(error?.message || error);
  if (code.includes('FUTURE_VERSION')) return '此存档来自更新版本，请先升级应用';
  if (code.includes('TOO_LARGE') || code.includes('SAVE_TOO_LARGE')) return '存档文件不能超过 20 MB';
  if (code.includes('INVALID_JSON')) return '文件不是有效的 JSON 存档';
  if (code.includes('MISSING_FIELDS')) return '存档缺少必要字段';
  if (code.includes('INVALID_VERSION')) return '存档格式版本无效';
  if (code.includes('INVALID_FILE_URI')) return '无法读取所选存档文件';
  if (code.includes('IMPORT_READ_FAILED')) return '存档读取失败，请重新选择文件';
  if (code.includes('EXPORT_WRITE_FAILED')) return '存档导出失败，请更换保存位置';
  if (code.includes('SHARED_SAVE_NOT_CONFIGURED')) return '请先设置外置存档目录';
  if (code.includes('SHARED_SAVE_ACCESS_FAILED')) return '外置存档目录不可用，请重新设置';
  if (code.includes('SHARED_SAVE_READ_FAILED')) return '外置存档读取失败，请稍后重试';
  if (code.includes('backup') || code.includes('IMPORT_BACKUP_FAILED')) return '导入前备份失败，当前存档未改变';
  if (code.includes('SAVE_WRITE_FAILED')) return '存档写入失败，已尝试恢复当前存档';
  if (code.includes('AggregateError') || error instanceof AggregateError) return '存档写入失败，已尝试恢复当前存档';
  return '存档操作失败，请稍后重试';
}

const SUMMARY_FIELDS = [
  ['lastSaveTime', '保存时间'],
  ['gender', '角色'],
  ['candy', '糖果'],
  ['teamCount', '队伍'],
  ['rosterCount', '仓库'],
  ['pokedexCount', '图鉴'],
];

const activeDialogCancels = new WeakMap();

export function cancelSaveTransferDialog(doc) {
  const dialog = doc?.querySelector?.('#saveTransferDialog');
  if (!dialog || dialog.hidden) return false;
  const cancel = activeDialogCancels.get(dialog);
  if (cancel) cancel();
  else {
    dialog.hidden = true;
    dialog.style.display = 'none';
  }
  return true;
}

function formatSummaryValue(key, value) {
  if (value == null) return '未知';
  if (key === 'gender') return { brendan: '小悠', may: '小遥' }[value] || '未知';
  if (key === 'lastSaveTime') return new Date(value).toLocaleString();
  return String(value);
}

export function showSaveTransferDialog(doc, details) {
  const dialog = doc?.querySelector?.('#saveTransferDialog');
  const confirmButton = doc?.querySelector?.('#saveTransferConfirm');
  const cancelButton = doc?.querySelector?.('#saveTransferCancel');
  const source = doc?.querySelector?.('#saveTransferSource');
  const title = doc?.querySelector?.('#saveTransferTitle');
  const comparison = doc?.querySelector?.('#saveTransferComparison');
  if (!dialog || !confirmButton || !cancelButton || !source || !title || !comparison) return Promise.resolve(false);

  title.textContent = details.restore ? '恢复导入前存档' : '确认覆盖存档';
  source.textContent = details.restore ? '导入前自动备份' : `文件：${details.source || '未命名存档'}`;
  comparison.replaceChildren();
  const currentSummary = details.current ? summarizeSave(details.current) : {};
  const incomingSummary = details.incoming ? summarizeSave(details.incoming) : {};
  for (const [key, label] of SUMMARY_FIELDS) {
    const row = doc.createElement('div');
    row.className = 'save-transfer-summary-row';
    const name = doc.createElement('span');
    name.className = 'save-transfer-summary-label';
    name.textContent = label;
    const values = doc.createElement('span');
    values.className = 'save-transfer-summary-values';
    const oldValue = doc.createElement('span');
    oldValue.textContent = formatSummaryValue(key, currentSummary[key]);
    const arrow = doc.createElement('span');
    arrow.textContent = '→';
    const newValue = doc.createElement('span');
    newValue.textContent = formatSummaryValue(key, incomingSummary[key]);
    values.append(oldValue, arrow, newValue);
    row.append(name, values);
    comparison.append(row);
  }

  dialog.hidden = false;
  dialog.style.display = 'flex';
  return new Promise(resolve => {
    let settled = false;
    const activationEvents = ['pointerup', 'touchend', 'click'];
    const removeActivationListeners = (button, handler) => {
      activationEvents.forEach(type => button.removeEventListener(type, handler));
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      dialog.hidden = true;
      dialog.style.display = 'none';
      activeDialogCancels.delete(dialog);
      removeActivationListeners(confirmButton, onConfirm);
      removeActivationListeners(cancelButton, onCancel);
      doc.removeEventListener('keydown', onKeyDown);
      resolve(result);
    };
    const onConfirm = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = event => {
      if (event.key === 'Escape') finish(false);
    };
    activationEvents.forEach(type => confirmButton.addEventListener(type, onConfirm));
    activationEvents.forEach(type => cancelButton.addEventListener(type, onCancel));
    doc.addEventListener('keydown', onKeyDown);
    activeDialogCancels.set(dialog, onCancel);
    confirmButton.focus?.();
  });
}

export function createSaveTransferController({
  platform = createSavePlatform(),
  getCurrent = () => null,
  saveGame = async () => {},
  saveCurrent,
  createBackup,
  apply = () => {},
  persist,
  confirm = async () => true,
  showMessage = () => {},
  showProgress = () => {},
  addLog = () => {},
  onSharedSaveWritten = () => {},
  onSharedSaveCandidate = () => {},
  reload = () => {},
  now = () => Date.now(),
} = {}) {
  let operationQueue = Promise.resolve();
  let reloadPending = false;
  const enqueue = operation => {
    const result = operationQueue.catch(() => {}).then(() => reloadPending ? null : operation());
    operationQueue = result.catch(() => {});
    return result;
  };
  const saveBeforeImport = saveCurrent || (() => saveGame({ strict: true }));
  const persistReplacement = persist || (() => saveGame({ strict: true, preserveTimestamp: true }));
  const backupCurrent = createBackup || (raw => platform.createImportBackup(raw));

  async function exportSave() {
    try {
      await saveGame();
      const current = getCurrent();
      const appVersion = await platform.getAppVersion();
      const output = serializeSaveForExport(current, { appVersion, now: now() });
      let sharedResult = null;
      if (platform.writeSharedSaveData) {
        try {
          sharedResult = await platform.writeSharedSaveData(output.json, 'pokeidle-save.json');
          if (sharedResult) onSharedSaveWritten(sharedResult);
        } catch (error) {
          if (!String(error?.code || error?.message || '').includes('SHARED_SAVE_NOT_CONFIGURED')) {
            addLog('shared_save_warning', { code: error?.code || 'SHARED_SAVE_ACCESS_FAILED' });
          }
        }
      }
      showProgress('请选择存档保存位置');
      const result = await platform.exportSaveData(output.json, output.fileName);
      if (result == null) {
        if (sharedResult) showMessage('外置存档已同步');
        return sharedResult ? { ...output, sharedResult } : null;
      }
      addLog('export', { fileName: output.fileName, result });
      showMessage(sharedResult ? '存档已导出并同步外置文件' : '存档已导出');
      return { ...output, sharedResult };
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function importFile(file, logType = 'import', onHandled = () => {}) {
    let persistenceWarnings = [];
    try {
      const parsed = parseSaveTransfer(file.content);
      const current = getCurrent();
      if (!await confirm({ source: file.name, current, incoming: parsed.data, summary: parsed.summary })) {
        try { onHandled(file); } catch (_) {}
        return null;
      }
      showProgress('正在备份当前存档');
      const replacement = await replaceSaveWithBackup({
        getCurrent,
        incoming: parsed.data,
        saveCurrent: saveBeforeImport,
        createBackup: async raw => {
          try {
            await backupCurrent(raw);
          } catch (error) {
            if (!error.code) error.code = 'IMPORT_BACKUP_FAILED';
            throw error;
          }
        },
        apply,
        persist: async () => {
          try {
            showProgress('正在写入新存档');
            const result = await persistReplacement();
            persistenceWarnings = result?.warnings || [];
            return result;
          } catch (error) {
            if (!error.code) error.code = 'SAVE_WRITE_FAILED';
            throw error;
          }
        },
        now: now(),
      });
      addLog(logType, { fileName: file.name, summary: parsed.summary });
      if (persistenceWarnings.length) {
        addLog('save_warning', { sources: persistenceWarnings.map(error => error.source) });
      }
      showMessage(persistenceWarnings.length
        ? '存档导入成功，备用存储不可用，即将刷新'
        : '存档导入成功，即将刷新');
      try { onHandled(file); } catch (_) {}
      reloadPending = true;
      reload();
      return replacement;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function importSave() {
    try {
      showProgress('正在读取存档');
      const file = await platform.pickImportFile();
      return file ? importFile(file) : null;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function importSharedSave(candidate = null) {
    try {
      showProgress('正在检查外置存档');
      const file = candidate || await platform.readSharedSaveData?.();
      if (!file?.configured || !file?.exists || !file.content) return null;
      return importFile(file, 'import_shared', onSharedSaveCandidate);
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function configureSharedSave() {
    try {
      const selected = await platform.selectSharedSaveDirectory?.();
      if (!selected) return null;
      await saveGame();
      const appVersion = await platform.getAppVersion();
      const output = serializeSaveForExport(getCurrent(), { appVersion, now: now() });
      const result = await platform.writeSharedSaveData(output.json, 'pokeidle-save.json');
      onSharedSaveWritten(result);
      showMessage('外置存档目录已设置并同步');
      return result;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  async function restoreSave() {
    let persistenceWarnings = [];
    try {
      const raw = await platform.loadImportBackup();
      if (!raw) return null;
      const parsed = parseSaveTransfer(raw);
      const current = getCurrent();
      if (!await confirm({ source: '导入前存档', current, incoming: parsed.data, summary: parsed.summary, restore: true })) return null;
      const replacement = await restoreBackupSave({
        getCurrent,
        backupData: parsed.data,
        apply,
        persist: async () => {
          try {
            const result = await persistReplacement();
            persistenceWarnings = result?.warnings || [];
            return result;
          } catch (error) {
            if (!error.code) error.code = 'SAVE_WRITE_FAILED';
            throw error;
          }
        },
      });
      addLog('restore_import_backup');
      if (persistenceWarnings.length) {
        addLog('save_warning', { sources: persistenceWarnings.map(error => error.source) });
      }
      showMessage(persistenceWarnings.length
        ? '已恢复导入前存档，备用存储不可用，即将刷新'
        : '已恢复导入前存档，即将刷新');
      reloadPending = true;
      reload();
      return replacement;
    } catch (error) {
      showMessage(formatSaveTransferError(error));
      return null;
    }
  }

  return {
    exportSave: () => enqueue(exportSave),
    importSave: () => enqueue(importSave),
    importSharedSave: candidate => enqueue(() => importSharedSave(candidate)),
    configureSharedSave: () => enqueue(configureSharedSave),
    restoreSave: () => enqueue(restoreSave),
  };
}

export function bindSaveTransferControls(container, options = {}) {
  const controller = options.controller || createSaveTransferController(options);
  const buttons = ['exportSaveBtn', 'importSaveBtn', 'restoreSaveBtn', 'configureSharedSaveBtn']
    .map(id => container.querySelector(`#${id}`))
    .filter(Boolean);
  const run = (button, operation) => async () => {
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    button.classList.add('is-busy');
    try {
      await operation();
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
      button.classList.remove('is-busy');
    }
  };
  const exportButton = container.querySelector('#exportSaveBtn');
  const importButton = container.querySelector('#importSaveBtn');
  const restoreButton = container.querySelector('#restoreSaveBtn');
  const configureSharedButton = container.querySelector('#configureSharedSaveBtn');
  exportButton?.addEventListener('click', run(exportButton, controller.exportSave));
  importButton?.addEventListener('click', run(importButton, controller.importSave));
  restoreButton?.addEventListener('click', run(restoreButton, controller.restoreSave));
  configureSharedButton?.addEventListener('click', run(configureSharedButton, controller.configureSharedSave));
  return controller;
}

export async function refreshImportBackupState(container, platform = createSavePlatform()) {
  const button = container.querySelector('#restoreSaveBtn');
  if (!button) return false;
  try {
    const raw = await platform.loadImportBackup();
    const available = Boolean(raw && parseSaveTransfer(raw));
    button.disabled = !available;
    button.setAttribute('aria-disabled', String(!available));
    return available;
  } catch (_) {
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
    return false;
  }
}
