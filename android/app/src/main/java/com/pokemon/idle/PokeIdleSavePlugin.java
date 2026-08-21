package com.pokemon.idle;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PokeIdleSave")
public class PokeIdleSavePlugin extends Plugin {
    private static final long SAVE_MAX_BYTES = 20L * 1024L * 1024L;
    private static final String SAVE_PATH = "save.json";
    private static final String BACKUP_PATH = "save.json.bak";
    private static final String TEMP_PATH = "save.json.tmp";
    private static final String IMPORT_BACKUP_PATH = "save.import-backup.json";
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();

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
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "*/*" });
        startActivityForResult(call, intent, "importActivityResult");
    }

    @ActivityCallback
    private void importActivityResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("无法读取所选存档文件", "INVALID_FILE_URI");
            return;
        }
        ioExecutor.execute(() -> {
            try {
                String content = readExternalFile(uri);
                JSObject response = new JSObject()
                    .put("name", displayName(uri))
                    .put("content", content)
                    .put("size", content.getBytes(StandardCharsets.UTF_8).length);
                call.resolve(response);
            } catch (SaveTooLargeException error) {
                call.reject("存档文件不能超过 20 MB", "SAVE_TOO_LARGE");
            } catch (Exception error) {
                call.reject("存档读取失败，请重新选择文件", "IMPORT_READ_FAILED", error);
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
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "exportActivityResult");
    }

    @ActivityCallback
    private void exportActivityResult(PluginCall call, ActivityResult result) {
        String data = call.getString("data");
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null || data == null) {
            call.reject("无法写入导出文件", "EXPORT_WRITE_FAILED");
            return;
        }
        ioExecutor.execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IOException("输出流为空");
                output.write(data.getBytes(StandardCharsets.UTF_8));
                output.flush();
                call.resolve(new JSObject().put("uri", uri.toString()));
            } catch (Exception error) {
                call.reject("存档导出失败，请更换保存位置", "EXPORT_WRITE_FAILED", error);
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
