package kr.yorun.recorder;

import android.Manifest;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "YorunRecorder", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class YorunRecorderPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private PluginCall pendingCommand;

    // Accessed on the main looper along with the service lifecycle to avoid marking a
    // live recorder interrupted during a simultaneous WebView refresh.
    private NativeJournal journal() throws Exception {
        NativeJournal store = NativeJournal.get(getContext());
        if (!RecordingService.alive) {
            try { store.recover(); }
            catch (Exception error) { RecordingService.failure = "중단 상태를 저장하지 못했습니다. 저장된 위치는 복원했으며 저장 공간을 확인해야 합니다."; }
        }
        return store;
    }

    @PluginMethod public void snapshot(PluginCall call) {
        main.post(() -> {
            try {
                JSObject result = journal().snapshot(call.getString("id"), !RecordingService.alive || RecordingService.stopping);
                if (RecordingService.failure != null) result.put("nativeError", RecordingService.failure);
                call.resolve(result);
            } catch (Exception error) { call.reject("저장된 기록을 읽지 못했습니다. 저장 공간을 확인하세요."); }
        });
    }

    @PluginMethod public void list(PluginCall call) {
        main.post(() -> {
            try { call.resolve(journal().list()); }
            catch (Exception error) { call.reject("러닝 목록을 읽지 못했습니다. 저장 공간을 확인하세요."); }
        });
    }

    @PluginMethod public void command(PluginCall call) {
        main.post(() -> {
            if (pendingCommand != null) { call.reject("이전 러닝 명령을 처리 중입니다."); return; }
            pendingCommand = call;
            try {
                if (RecordingService.stopping) throw new Exception("이전 위치 서비스가 종료 중입니다. 잠시 후 다시 시도하세요.");
                String action = call.getString("action", "");
                journal().validate(action);
                if (action.equals("start") || action.equals("resume")) {
                    requireForeground();
                    if (getPermissionState("location") != PermissionState.GRANTED) {
                        requestPermissionForAlias("location", call, "locationResult");
                        return;
                    }
                    askNotification(call);
                } else executeCommand(call);
            } catch (Exception error) { finish(call, error.getMessage()); }
        });
    }

    private void requireForeground() throws Exception {
        if (getActivity() == null || getActivity().isFinishing() || !getBridge().getApp().isActive()) {
            throw new Exception("앱을 화면에 연 상태에서 러닝을 시작하거나 재개하세요.");
        }
    }

    @PermissionCallback private void locationResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            finish(call, "정확한 위치 권한이 필요합니다. 휴대폰 설정에서 요런의 위치 권한과 정확한 위치를 허용한 뒤 다시 시작하세요.");
            return;
        }
        askNotification(call);
    }

    private void askNotification(PluginCall call) {
        try {
            requireForeground();
            PermissionState state = getPermissionState("notifications");
            if (Build.VERSION.SDK_INT >= 33 && (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE)) {
                requestPermissionForAlias("notifications", call, "notificationResult");
                return;
            }
            executeCommand(call);
        } catch (Exception error) { finish(call, error.getMessage()); }
    }

    // Notification denial does not prohibit a foreground service. Android still exposes
    // it in Active apps; the journal adds a user-visible diagnostic for the missing alert.
    @PermissionCallback private void notificationResult(PluginCall call) { executeCommand(call); }

    private void executeCommand(PluginCall call) {
        try {
            if (RecordingService.stopping) throw new Exception("이전 위치 서비스가 종료 중입니다. 잠시 후 다시 시도하세요.");
            NativeJournal store = journal();
            String action = call.getString("action", "");
            store.validate(action);
            boolean startsLocation = action.equals("start") || action.equals("resume");
            if (startsLocation) requireForeground();
            if (!startsLocation && !RecordingService.alive) {
                store.command(action);
                finish(call, null);
                return;
            }
            Intent intent = new Intent(getContext(), RecordingService.class);
            intent.putExtra("action", action);
            Runnable timeout = () -> finish(call, "위치 서비스 응답이 지연됩니다. 현재 기록 상태를 확인한 뒤 다시 시도하세요.");
            intent.putExtra("reply", new ResultReceiver(main) {
                @Override protected void onReceiveResult(int resultCode, Bundle data) {
                    main.removeCallbacks(timeout);
                    finish(call, resultCode == 0 ? null : data.getString("error", "위치 서비스를 시작하지 못했습니다."));
                }
            });
            if (Build.VERSION.SDK_INT >= 26 && startsLocation) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            main.postDelayed(timeout, 15000);
        } catch (Exception error) {
            finish(call, "러닝 명령을 처리하지 못했습니다. 앱을 화면에 열고 위치 권한과 저장 공간을 확인하세요.");
        }
    }

    private void finish(PluginCall call, String error) {
        if (pendingCommand != call) return;
        pendingCommand = null;
        if (error == null) call.resolve(new JSObject());
        else call.reject(error);
    }

    @PluginMethod public void exportFile(PluginCall call) {
        try {
            String name = call.getString("filename", ""), data = call.getString("data", "");
            if (!name.matches("yorun-[a-zA-Z0-9-]+\\.(gpx|json)") || data.length() > 20_000_000 || data.isEmpty()) {
                call.reject("내보내기 파일 형식 또는 크기가 올바르지 않습니다.");
                return;
            }
            File directory = new File(getContext().getCacheDir(), "yorun-exports");
            if (!directory.exists() && !directory.mkdirs()) throw new Exception("export directory");
            File target = new File(directory, name);
            try (FileOutputStream output = new FileOutputStream(target)) {
                output.write(data.getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
            Uri uri = RecorderFileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".yorun.recorder.files", target);
            Intent share = new Intent(Intent.ACTION_SEND).setType(name.endsWith("gpx") ? "application/gpx+xml" : "application/json")
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            share.setClipData(ClipData.newRawUri(name, uri));
            main.post(() -> {
                try {
                    getActivity().startActivity(Intent.createChooser(share, "러닝 기록 공유"));
                    call.resolve(new JSObject());
                } catch (Exception error) { call.reject("공유할 앱을 열지 못했습니다."); }
            });
        } catch (Exception error) { call.reject("내보내기 파일을 만들지 못했습니다. 저장 공간을 확인하세요."); }
    }
}
