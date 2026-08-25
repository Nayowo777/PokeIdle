import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Android bridge 使用 PokeIdleSave 原生插件处理全部存档 I/O', async () => {
  const bridgeSource = await readFile(new URL('../mobile/bridge-source.js', import.meta.url), 'utf8');
  assert.match(bridgeSource, /registerPlugin\(['"]PokeIdleSave['"]\)/);
  assert.match(bridgeSource, /pickImportFile/);
  assert.match(bridgeSource, /exportSaveData/);
  assert.match(bridgeSource, /createImportBackup/);
  assert.match(bridgeSource, /loadImportBackup/);
  assert.match(bridgeSource, /loadGameData/);
  assert.match(bridgeSource, /saveGameData/);
  assert.doesNotMatch(bridgeSource, /Share\.share|from ['"]@capacitor\/share['"]/);
  assert.doesNotMatch(bridgeSource, /Filesystem\.(readFile|writeFile|getUri|deleteFile)/);
});

test('Android 原生存档插件使用 SAF 和私有目录原子写入', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java', import.meta.url), 'utf8');
  const activity = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/MainActivity.java', import.meta.url), 'utf8');

  assert.match(plugin, /@CapacitorPlugin\(name = "PokeIdleSave"\)/);
  assert.match(plugin, /Intent\.ACTION_OPEN_DOCUMENT/);
  assert.match(plugin, /Intent\.ACTION_CREATE_DOCUMENT/);
  assert.match(plugin, /SAVE_MAX_BYTES\s*=\s*20L\s*\*\s*1024L\s*\*\s*1024L/);
  assert.match(plugin, /getFilesDir\(\)/);
  assert.match(plugin, /save\.json\.tmp/);
  assert.match(plugin, /save\.json\.bak/);
  assert.match(plugin, /SAVE_TOO_LARGE/);
  assert.match(plugin, /@ActivityCallback/);
  assert.match(activity, /registerPlugin\(PokeIdleSavePlugin\.class\)/);
});

test('Android 原生存档插件支持共享目录授权与固定外置存档', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java', import.meta.url), 'utf8');

  assert.match(plugin, /Intent\.ACTION_OPEN_DOCUMENT_TREE/);
  assert.match(plugin, /takePersistableUriPermission/);
  assert.match(plugin, /SharedPreferences/);
  assert.match(plugin, /pokeidle-save\.json/);
  assert.match(plugin, /SHARED_SAVE_ACCESS_FAILED/);
  assert.match(plugin, /AtomicBoolean/);
  assert.match(plugin, /writeSharedSaveData/);
  assert.match(plugin, /readSharedSaveData/);
  assert.match(plugin, /MessageDigest/);
});

test('Android 外置存档替换失败时不会把半写文件当作可恢复主存档', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java', import.meta.url), 'utf8');

  assert.match(plugin, /if \(backup == null\) throw new IOException\("无法创建共享存档备份"\)/);
  assert.match(plugin, /backupReady = true/);
  assert.match(plugin, /if \(failedTarget != null\) failedTarget\.delete\(\)/);
  assert.match(plugin, /if \(backupReady\) restoreSharedBackup\(root, resolver\)/);
  assert.doesNotMatch(plugin, /if \(root\.findFile\(SHARED_SAVE_FILE\) != null\) return/);
});

test('Android Activity 结果使用跨回调的一次性领取状态', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java', import.meta.url), 'utf8');

  assert.match(plugin, /handledActivityCalls/);
  assert.match(plugin, /claimActivityResult\(PluginCall call\)/);
  assert.equal((plugin.match(/if \(!claimActivityResult\(call\)\) return;/g) || []).length, 3);
});

test('Android 外置存档临时读取失败不会清除持久目录授权', async () => {
  const plugin = await readFile(new URL('../android/app/src/main/java/com/pokemon/idle/PokeIdleSavePlugin.java', import.meta.url), 'utf8');

  assert.match(plugin, /hasPersistedSharedPermission\(Uri uri\)/);
  assert.match(plugin, /if \(!hasPersistedSharedPermission\(treeUri\)\)[\s\S]*?clearSharedDirectory\(\)/);
  assert.match(plugin, /catch \(SecurityException error\)[\s\S]*?clearSharedDirectory\(\)/);
  assert.match(plugin, /catch \(Exception error\)[\s\S]*?SHARED_SAVE_READ_FAILED/);
  assert.doesNotMatch(plugin, /catch \(SharedDirectoryUnavailableException \| SecurityException error\)/);
});

test('Android manifest 不申请公共存储权限', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');

  assert.doesNotMatch(manifest, /READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
});

test('Tauri 提供可取消的文件选择和导入前备份命令', async () => {
  const source = await readFile(new URL('../src-tauri/src/game_data.rs', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  assert.match(source, /set_file_name/);
  assert.match(source, /SAVE_MAX_BYTES[^]*20 \* 1024 \* 1024/);
  assert.match(source, /SAVE_TOO_LARGE/);
  assert.match(source, /create_import_backup/);
  assert.match(source, /load_import_backup/);
  assert.match(source, /save\.import-backup\.json/);
  assert.match(source, /Result<Option<ImportedSaveFile>, String>/);
  assert.match(source, /serde\(rename_all = "camelCase"\)/);
  assert.match(lib, /game_data::create_import_backup/);
  assert.match(lib, /game_data::load_import_backup/);
});

test('Tauri Windows API 依赖只在 Windows 目标编译', async () => {
  const cargo = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const commonDependencies = cargo.split("[target.'cfg(windows)'.dependencies]")[0];

  assert.doesNotMatch(commonDependencies, /^windows\s*=/m);
  assert.match(cargo, /\[target\.'cfg\(windows\)'\.dependencies\][^]*^windows\s*=/m);
});
