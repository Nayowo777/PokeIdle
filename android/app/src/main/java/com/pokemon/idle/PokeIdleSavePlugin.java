package com.pokemon.idle;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.content.UriPermission;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "PokeIdleSave")
public class PokeIdleSavePlugin extends Plugin {
    private static final long SAVE_MAX_BYTES = 20L * 1024L * 1024L;
    private static final String SAVE_PATH = "save.json";
    private static final String BACKUP_PATH = "save.json.bak";
    private static final String TEMP_PATH = "save.json.tmp";
    private static final String IMPORT_BACKUP_PATH = "save.import-backup.json";
    private static final String SHARED_SAVE_FILE = "pokeidle-save.json";
    private static final String SHARED_BACKUP_FILE = "pokeidle-save.json.bak";
    private static final String SHARED_TEMP_FILE = "pokeidle-save.json.tmp";
    private static final String PREFERENCES_NAME = "pokeidle_save_preferences";
    private static final String SHARED_TREE_URI_KEY = "shared_save_tree_uri";
    private static final int HANDLED_ACTIVITY_CALL_LIMIT = 64;
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final Map<String, Boolean> handledActivityCalls = new LinkedHashMap<String, Boolean>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > HANDLED_ACTIVITY_CALL_LIMIT;
        }
    };

    @PluginMethod
    public void loadGameData(PluginCall call) {
        ioExecutor.execute(() -> {
            JSObject result = new JSObject();
            result.put("main", readPrivateFile(SAVE_PATH));
            result.put("backup", readPrivateFile(BACKUP_PATH));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void saveGameData(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("缺少存档数据", "SAVE_WRITE_FAILED");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                File main = privateFile(SAVE_PATH);
                if (main.isFile()) copyFile(main, privateFile(BACKUP_PATH));
                writeAtomically(data, main);
                call.resolve();
            } catch (Exception error) {
                call.reject("主存档写入失败", "SAVE_WRITE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void pickImportFile(PluginCall call) {
        prepareActivityResult(call);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "*/*" });
        startActivityForResult(call, intent, "importActivityResult");
    }

    @ActivityCallback
    private void importActivityResult(PluginCall call, ActivityResult result) {
        if (!claimActivityResult(call)) return;
        AtomicBoolean completed = new AtomicBoolean(false);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            resolveOnce(call, completed, new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            rejectOnce(call, completed, "无法读取所选存档文件", "INVALID_FILE_URI", null);
            return;
        }
        ioExecutor.execute(() -> {
            try {
                String content = readExternalFile(uri);
                JSObject response = new JSObject()
                    .put("name", displayName(uri))
                    .put("content", content)
                    .put("size", content.getBytes(StandardCharsets.UTF_8).length);
                resolveOnce(call, completed, response);
            } catch (SaveTooLargeException error) {
                rejectOnce(call, completed, "存档文件不能超过 20 MB", "SAVE_TOO_LARGE", error);
            } catch (Exception error) {
                rejectOnce(call, completed, "存档读取失败，请重新选择文件", "IMPORT_READ_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void exportSaveData(PluginCall call) {
        String data = call.getString("data");
        String fileName = call.getString("fileName", "pokeidle-save.json");
        if (data == null) {
            call.reject("缺少导出数据", "EXPORT_WRITE_FAILED");
            return;
        }
        prepareActivityResult(call);
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "exportActivityResult");
    }

    @ActivityCallback
    private void exportActivityResult(PluginCall call, ActivityResult result) {
        if (!claimActivityResult(call)) return;
        AtomicBoolean completed = new AtomicBoolean(false);
        String data = call.getString("data");
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            resolveOnce(call, completed, new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null || data == null) {
            rejectOnce(call, completed, "无法写入导出文件", "EXPORT_WRITE_FAILED", null);
            return;
        }
        ioExecutor.execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException("输出流为空");
                output.write(data.getBytes(StandardCharsets.UTF_8));
                output.flush();
                resolveOnce(call, completed, new JSObject().put("uri", uri.toString()));
            } catch (Exception error) {
                rejectOnce(call, completed, "存档导出失败，请更换保存位置", "EXPORT_WRITE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void createImportBackup(PluginCall call) {
        writePrivate(call, IMPORT_BACKUP_PATH, "IMPORT_BACKUP_FAILED");
    }

    @PluginMethod
    public void loadImportBackup(PluginCall call) {
        ioExecutor.execute(() -> call.resolve(new JSObject().put("data", readPrivateFile(IMPORT_BACKUP_PATH))));
    }

    @PluginMethod
    public void selectSharedSaveDirectory(PluginCall call) {
        prepareActivityResult(call);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            .addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            .addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        Uri initialUri = DocumentsContract.buildDocumentUri(
            "com.android.externalstorage.documents",
            "primary:" + Environment.DIRECTORY_DOWNLOADS
        );
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, initialUri);
        startActivityForResult(call, intent, "sharedDirectoryActivityResult");
    }

    @ActivityCallback
    private void sharedDirectoryActivityResult(PluginCall call, ActivityResult result) {
        if (!claimActivityResult(call)) return;
        AtomicBoolean completed = new AtomicBoolean(false);
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            resolveOnce(call, completed, new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = data.getData();
        if (uri == null) {
            rejectOnce(call, completed, "无法访问所选目录", "SHARED_SAVE_ACCESS_FAILED", null);
            return;
        }
        try {
            int flags = data.getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if (flags == 0) {
                flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            }
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            preferences().edit().putString(SHARED_TREE_URI_KEY, uri.toString()).apply();
            resolveOnce(call, completed, new JSObject()
                .put("selected", true)
                .put("uri", uri.toString())
                .put("fileName", SHARED_SAVE_FILE));
        } catch (Exception error) {
            rejectOnce(call, completed, "无法保存共享目录权限", "SHARED_SAVE_ACCESS_FAILED", error);
        }
    }

    @PluginMethod
    public void readSharedSaveData(PluginCall call) {
        AtomicBoolean completed = new AtomicBoolean(false);
        ioExecutor.execute(() -> {
            String uriString = preferences().getString(SHARED_TREE_URI_KEY, null);
            if (uriString == null) {
                resolveOnce(call, completed, new JSObject().put("configured", false).put("exists", false));
                return;
            }
            Uri treeUri = Uri.parse(uriString);
            if (!hasPersistedSharedPermission(treeUri)) {
                clearSharedDirectory();
                rejectOnce(call, completed, "共享存档目录授权已失效，请重新选择", "SHARED_SAVE_ACCESS_FAILED", null);
                return;
            }
            try {
                DocumentFile root = requireSharedRoot(treeUri);
                DocumentFile save = root.findFile(SHARED_SAVE_FILE);
                if (save == null || !save.isFile()) {
                    resolveOnce(call, completed, new JSObject()
                        .put("configured", true)
                        .put("exists", false)
                        .put("fileName", SHARED_SAVE_FILE));
                    return;
                }
                String content = readExternalFile(save.getUri());
                byte[] contentBytes = content.getBytes(StandardCharsets.UTF_8);
                resolveOnce(call, completed, new JSObject()
                    .put("configured", true)
                    .put("exists", true)
                    .put("name", SHARED_SAVE_FILE)
                    .put("content", content)
                    .put("size", contentBytes.length)
                    .put("fingerprint", sha256(contentBytes))
                    .put("modifiedAt", save.lastModified()));
            } catch (SaveTooLargeException error) {
                rejectOnce(call, completed, "存档文件不能超过 20 MB", "SAVE_TOO_LARGE", error);
            } catch (SecurityException error) {
                clearSharedDirectory();
                rejectOnce(call, completed, "共享存档目录不可用，请重新选择", "SHARED_SAVE_ACCESS_FAILED", error);
            } catch (Exception error) {
                rejectOnce(call, completed, "共享存档读取失败，请稍后重试", "SHARED_SAVE_READ_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void writeSharedSaveData(PluginCall call) {
        AtomicBoolean completed = new AtomicBoolean(false);
        String data = call.getString("data");
        if (data == null) {
            rejectOnce(call, completed, "缺少导出数据", "EXPORT_WRITE_FAILED", null);
            return;
        }
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > SAVE_MAX_BYTES) {
            rejectOnce(call, completed, "存档文件不能超过 20 MB", "SAVE_TOO_LARGE", null);
            return;
        }
        ioExecutor.execute(() -> {
            String uriString = preferences().getString(SHARED_TREE_URI_KEY, null);
            if (uriString == null) {
                rejectOnce(call, completed, "请先选择共享存档目录", "SHARED_SAVE_NOT_CONFIGURED", null);
                return;
            }
            try {
                DocumentFile root = requireSharedRoot(uriString);
                writeSharedAtomically(root, bytes);
                DocumentFile save = root.findFile(SHARED_SAVE_FILE);
                resolveOnce(call, completed, new JSObject()
                    .put("written", true)
                    .put("fileName", SHARED_SAVE_FILE)
                    .put("fingerprint", sha256(bytes))
                    .put("modifiedAt", save == null ? 0 : save.lastModified()));
            } catch (Exception error) {
                rejectOnce(call, completed, "共享存档写入失败，请重新选择目录", "SHARED_SAVE_ACCESS_FAILED", error);
            }
        });
    }

    private void writePrivate(PluginCall call, String path, String errorCode) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("缺少存档数据", errorCode);
            return;
        }
        ioExecutor.execute(() -> {
            try {
                writeAtomically(data, privateFile(path));
                call.resolve();
            } catch (Exception error) {
                call.reject("存档写入失败", errorCode, error);
            }
        });
    }

    private File privateFile(String path) {
        return new File(getContext().getFilesDir(), path);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, Activity.MODE_PRIVATE);
    }

    private void clearSharedDirectory() {
        preferences().edit().remove(SHARED_TREE_URI_KEY).apply();
    }

    private boolean hasPersistedSharedPermission(Uri uri) {
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(uri) && permission.isReadPermission() && permission.isWritePermission()) {
                return true;
            }
        }
        return false;
    }

    private DocumentFile requireSharedRoot(String uriString) throws IOException {
        return requireSharedRoot(Uri.parse(uriString));
    }

    private DocumentFile requireSharedRoot(Uri treeUri) throws IOException {
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), treeUri);
        if (root == null || !root.exists() || !root.isDirectory() || !root.canRead() || !root.canWrite()) {
            throw new IOException("共享目录暂时不可用");
        }
        return root;
    }

    private void prepareActivityResult(PluginCall call) {
        synchronized (handledActivityCalls) {
            handledActivityCalls.remove(call.getCallbackId());
        }
    }

    private boolean claimActivityResult(PluginCall call) {
        synchronized (handledActivityCalls) {
            String callbackId = call.getCallbackId();
            if (handledActivityCalls.containsKey(callbackId)) return false;
            handledActivityCalls.put(callbackId, true);
            return true;
        }
    }

    private void resolveOnce(PluginCall call, AtomicBoolean completed, JSObject result) {
        if (completed.compareAndSet(false, true)) call.resolve(result);
    }

    private void rejectOnce(PluginCall call, AtomicBoolean completed, String message, String code, Exception error) {
        if (!completed.compareAndSet(false, true)) return;
        if (error == null) call.reject(message, code);
        else call.reject(message, code, error);
    }

    private void writeSharedAtomically(DocumentFile root, byte[] bytes) throws IOException, SaveTooLargeException {
        ContentResolver resolver = getContext().getContentResolver();
        DocumentFile staleTemporary = root.findFile(SHARED_TEMP_FILE);
        if (staleTemporary != null) staleTemporary.delete();
        DocumentFile temporary = root.createFile("application/json", SHARED_TEMP_FILE);
        if (temporary == null) throw new IOException("无法创建临时存档");
        DocumentFile failedTarget = null;
        boolean backupReady = false;
        try {
            writeDocument(resolver, temporary.getUri(), bytes);
            DocumentFile current = root.findFile(SHARED_SAVE_FILE);
            if (current != null && current.isFile()) {
                String previous = readExternalFile(current.getUri());
                DocumentFile backup = root.findFile(SHARED_BACKUP_FILE);
                if (backup == null) backup = root.createFile("application/json", SHARED_BACKUP_FILE);
                if (backup == null) throw new IOException("无法创建共享存档备份");
                writeDocument(resolver, backup.getUri(), previous.getBytes(StandardCharsets.UTF_8));
                backupReady = true;
                if (!current.delete()) throw new IOException("无法替换旧共享存档");
            }
            if (!temporary.renameTo(SHARED_SAVE_FILE)) {
                failedTarget = root.createFile("application/json", SHARED_SAVE_FILE);
                if (failedTarget == null) throw new IOException("无法创建共享存档");
                writeDocument(resolver, failedTarget.getUri(), bytes);
                temporary.delete();
            }
        } catch (Exception error) {
            temporary.delete();
            if (failedTarget != null) failedTarget.delete();
            try {
                if (backupReady) restoreSharedBackup(root, resolver);
            } catch (Exception restoreError) {
                error.addSuppressed(restoreError);
            }
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("共享存档替换失败", error);
        }
    }

    private void restoreSharedBackup(DocumentFile root, ContentResolver resolver) throws IOException {
        DocumentFile backup = root.findFile(SHARED_BACKUP_FILE);
        if (backup == null || !backup.isFile()) throw new IOException("共享存档备份不存在");
        String previous = readExternalFile(backup.getUri());
        DocumentFile restored = root.findFile(SHARED_SAVE_FILE);
        if (restored == null) restored = root.createFile("application/json", SHARED_SAVE_FILE);
        if (restored == null) throw new IOException("无法恢复共享存档备份");
        writeDocument(resolver, restored.getUri(), previous.getBytes(StandardCharsets.UTF_8));
    }

    private void writeDocument(ContentResolver resolver, Uri uri, byte[] bytes) throws IOException {
        try (OutputStream output = resolver.openOutputStream(uri, "wt")) {
            if (output == null) throw new IOException("输出流为空");
            output.write(bytes);
            output.flush();
        }
    }

    private String sha256(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte value : digest) hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }

    private String readPrivateFile(String path) {
        File file = privateFile(path);
        if (!file.isFile()) return null;
        try (InputStream input = new FileInputStream(file)) {
            return readLimited(input);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String readExternalFile(Uri uri) throws IOException, SaveTooLargeException {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("输入流为空");
            return readLimited(input);
        }
    }

    private String readLimited(InputStream input) throws IOException, SaveTooLargeException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > SAVE_MAX_BYTES) throw new SaveTooLargeException();
            output.write(buffer, 0, count);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {}
        return "save.json";
    }

    private void writeAtomically(String data, File target) throws IOException {
        File temporary = privateFile(TEMP_PATH);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(data.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    private void copyFile(File source, File target) throws IOException {
        try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(target, false)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            output.flush();
        }
    }

    private static final class SaveTooLargeException extends IOException {}

}
