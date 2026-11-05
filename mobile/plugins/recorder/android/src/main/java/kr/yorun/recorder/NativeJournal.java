package kr.yorun.recorder;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import com.getcapacitor.JSObject;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/** All writes happen in native code; the WebView is never a persistence dependency. */
final class NativeJournal {
    private static NativeJournal instance;
    private final File directory;
    private final SharedPreferences preferences;
    private String id;
    private String status = "empty";
    private long lastDurableTime;
    private String storageFailure;

    static synchronized NativeJournal get(Context context) throws Exception {
        if (instance == null) instance = new NativeJournal(context);
        return instance;
    }

    private NativeJournal(Context context) throws Exception {
        this(new File(context.getNoBackupFilesDir(), "yorun-runs"), context.getSharedPreferences("yorun-recorder", Context.MODE_PRIVATE));
    }

    // Package-private storage seam permits journal recovery tests without an Android device.
    NativeJournal(File directory, SharedPreferences preferences) throws Exception {
        this.directory = directory;
        this.preferences = preferences;
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("러닝 저장 폴더를 만들 수 없습니다.");
        String[] files = names();
        String saved = preferences.getString("currentId", null);
        if (saved != null && validId(saved) && file(saved).length() > 0) id = saved;
        else if (files.length > 0) id = files[files.length - 1].replace(".jsonl", "");
        if (id != null) {
            try { repairTail(file(id)); }
            catch (Exception error) { storageFailure = "불완전한 기록 끝부분을 복구하지 못했습니다. 저장 공간을 확인하세요."; }
            JSONArray events = read(id);
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                apply(event);
            }
        }
    }

    private boolean validId(String recordId) {
        return recordId != null && recordId.matches("[0-9]{13}-[a-f0-9-]{36}");
    }

    private String[] names() {
        String[] values = directory.list((dir, name) -> name.matches("[0-9]{13}-[a-f0-9-]{36}\\.jsonl") && new File(dir, name).length() > 0);
        if (values == null) return new String[0];
        Arrays.sort(values);
        return values;
    }

    private File file(String recordId) throws Exception {
        if (!validId(recordId)) throw new Exception("잘못된 기록 ID입니다.");
        return new File(directory, recordId + ".jsonl");
    }

    // A killed process can leave an incomplete final record. Keep all complete records.
    private void repairTail(File target) throws Exception {
        try (RandomAccessFile out = new RandomAccessFile(target, "rw")) {
            long end = out.length();
            while (end > 0) {
                out.seek(end - 1);
                if (out.read() == '\n') break;
                end--;
            }
            if (end != out.length()) { out.setLength(end); out.getFD().sync(); }
        }
    }

    private JSONArray read(String recordId) throws Exception {
        JSONArray events = new JSONArray();
        if (recordId == null) return events;
        // Java NIO Files requires API 26; this reader also works on the API 24 minimum.
        // An unacknowledged partial final line is ignored, including in historical records.
        try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file(recordId)));
             ByteArrayOutputStream line = new ByteArrayOutputStream()) {
            int value;
            while ((value = input.read()) != -1) {
                if (value == '\n') {
                    if (line.size() > 0) events.put(new JSONObject(new String(line.toByteArray(), StandardCharsets.UTF_8)));
                    line.reset();
                } else line.write(value);
            }
        }
        return events;
    }

    private void apply(JSONObject event) {
        String type = event.optString("type");
        if (type.equals("start") || type.equals("resume")) status = "running";
        if (type.equals("pause")) status = "paused";
        if (type.equals("stop")) status = "stopped";
        if (type.equals("interrupted")) status = "interrupted";
        lastDurableTime = Math.max(lastDurableTime, event.optLong("receivedAt", event.optLong("time")));
    }

    private void append(JSONObject event) throws Exception {
        byte[] data = (event.toString() + "\n").getBytes(StandardCharsets.UTF_8);
        // A failed earlier repair must never cause a new event to join a partial line.
        repairTail(file(id));
        try (RandomAccessFile output = new RandomAccessFile(file(id), "rw")) {
            long before = output.length();
            try {
                output.seek(before);
                output.write(data);
                output.getFD().sync();
            } catch (Exception error) {
                // Do not append future JSON onto a partially written line in this process.
                try { output.setLength(before); output.getFD().sync(); } catch (Exception ignored) {}
                storageFailure = "기록을 저장하지 못했습니다. 저장 공간을 확인하세요.";
                throw error;
            }
        }
        apply(event);
        storageFailure = null;
    }

    synchronized String status() { return status; }

    synchronized void recover() throws Exception {
        if (status.equals("running")) {
            JSONObject event = new JSONObject().put("type", "interrupted").put("time", lastDurableTime)
                .put("recoveredAt", System.currentTimeMillis()).put("reason", "앱/서비스 재시작으로 기록이 중단되었습니다. 저장된 지점부터 복원했으며 재개가 필요합니다.");
            append(event);
        }
    }

    synchronized void validate(String action) throws Exception {
        if (action.equals("start")) {
            if (!status.equals("empty") && !status.equals("stopped")) throw new Exception("진행 중인 러닝을 먼저 종료하세요.");
        } else if (action.equals("resume")) {
            if (!status.equals("paused") && !status.equals("interrupted")) throw new Exception("일시정지 또는 중단된 기록만 재개할 수 있습니다.");
        } else if (action.equals("pause")) {
            if (!status.equals("running")) throw new Exception("기록 중에만 일시정지할 수 있습니다.");
        } else if (action.equals("stop")) {
            if (status.equals("empty") || status.equals("stopped")) throw new Exception("종료할 러닝이 없습니다.");
        } else throw new Exception("지원하지 않는 명령입니다.");
    }

    synchronized void command(String action) throws Exception {
        validate(action);
        String previousId = id, previousStatus = status;
        long previousTime = lastDurableTime;
        if (action.equals("start")) {
            String next = System.currentTimeMillis() + "-" + UUID.randomUUID();
            // Persist the pointer before creating the first event. If killed in this small
            // window, the previous record was already stopped, and recovery falls back to it.
            if (!preferences.edit().putString("currentId", next).commit()) throw new Exception("현재 러닝 정보를 저장할 수 없습니다.");
            id = next;
            status = "empty";
            lastDurableTime = 0;
        }
        try {
            append(new JSONObject().put("type", action).put("time", System.currentTimeMillis()).put("platform", "android"));
        } catch (Exception error) {
            if (action.equals("start")) {
                id = previousId;
                status = previousStatus;
                lastDurableTime = previousTime;
                // An empty failed journal is never selected by recovery or history.
                preferences.edit().putString("currentId", previousId).commit();
            }
            throw error;
        }
    }

    synchronized void point(Location location) throws Exception {
        if (!status.equals("running")) return;
        append(new JSONObject().put("type", "point").put("time", location.getTime()).put("receivedAt", System.currentTimeMillis())
            .put("lat", location.getLatitude()).put("lng", location.getLongitude()).put("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1)
            .put("speed", location.hasSpeed() ? location.getSpeed() : -1).put("provider", location.getProvider()));
    }

    synchronized void error(String reason) throws Exception {
        if (id != null) append(new JSONObject().put("type", "error").put("time", System.currentTimeMillis()).put("reason", reason));
    }

    synchronized JSObject snapshot(String requestedId, boolean serviceStopped) throws Exception {
        String chosen = requestedId == null ? id : requestedId;
        JSONArray events = read(chosen);
        if (chosen != null && chosen.equals(id) && status.equals("running") && serviceStopped) {
            // When a disk is full, reading/exporting the durable prefix must still work.
            // This marked view-only boundary freezes elapsed time; it is not an acked write.
            events.put(new JSONObject().put("type", "interrupted").put("time", lastDurableTime)
                .put("volatile", true).put("reason", "기록이 중단되었으며 중단 상태를 저장하지 못했습니다. 저장 공간을 확인하세요."));
        }
        JSObject result = new JSObject();
        result.put("id", chosen == null ? JSONObject.NULL : chosen);
        result.put("events", events);
        if (storageFailure != null) result.put("nativeError", storageFailure);
        result.put("osVersion", android.os.Build.VERSION.RELEASE);
        result.put("device", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
        return result;
    }

    synchronized JSObject list() throws Exception {
        JSONArray records = new JSONArray();
        String[] files = names();
        for (int i = files.length - 1; i >= 0; i--) records.put(new JSONObject().put("id", files[i].replace(".jsonl", "")));
        JSObject result = new JSObject(); result.put("records", records); return result;
    }
}
