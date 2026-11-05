package kr.yorun.recorder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.ResultReceiver;

/** Location callbacks and lifecycle commands remain native when the WebView is suspended. */
public final class RecordingService extends Service implements LocationListener {
    static volatile boolean alive = false;
    static volatile boolean stopping = false;
    static volatile String failure = null;
    private LocationManager locations;
    private NativeJournal journal;
    private boolean recording = false;
    private static final String CHANNEL = "yorun-recording";

    @Override public void onCreate() {
        super.onCreate();
        alive = true;
        stopping = false;
        locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        try {
            journal = NativeJournal.get(this);
            // A newly created service cannot own a previous process's running session.
            journal.recover();
        } catch (Exception error) {
            failure = "저장된 러닝을 복원할 수 없습니다. 저장 공간을 확인하세요.";
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { shutdown(); return START_NOT_STICKY; }
        ResultReceiver reply = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra("reply", ResultReceiver.class) : intent.getParcelableExtra("reply");
        String action = intent.getStringExtra("action");
        // Validation errors must not tear down an existing run (e.g. a repeated start).
        try {
            if (stopping) throw new Exception("이전 위치 서비스가 종료 중입니다. 잠시 후 다시 시도하세요.");
            if (journal == null || action == null) throw new Exception("러닝 저장소를 준비할 수 없습니다.");
            journal.validate(action);
        } catch (Exception error) {
            respond(reply, error.getMessage());
            if (!recording) shutdown();
            return START_NOT_STICKY;
        }
        try {
            if ("start".equals(action) || "resume".equals(action)) {
                if (locations == null || !locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    respond(reply, "휴대폰 설정에서 위치 서비스를 켜주세요.");
                    shutdown();
                    return START_NOT_STICKY;
                }
                showNotification();
                // Callbacks and commands share the main looper, so no fix can race a
                // pause/resume or be stored between registration and the start event.
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0, this, Looper.getMainLooper());
                journal.command(action);
                recording = true;
                failure = null;
                NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (manager != null && !manager.areNotificationsEnabled()) {
                    journal.error("알림이 허용되지 않아 알림창에서 러닝 기록 상태를 볼 수 없습니다. 휴대폰 설정에서 알림을 허용하세요.");
                }
            } else {
                // Acknowledge pause/stop only after its event is durably stored.
                journal.command(action);
                shutdown();
            }
            respond(reply, null);
        } catch (Exception error) {
            fail(error instanceof SecurityException
                ? "위치 권한이 없어 기록이 중단되었습니다. 정확한 위치 권한을 확인한 뒤 재개하세요."
                : "위치 기록을 시작하거나 저장하지 못했습니다. 위치 설정과 저장 공간을 확인하세요.");
            respond(reply, failure);
        }
        // No restart, boot receiver or hidden background start: a restart requires user resume.
        return START_NOT_STICKY;
    }

    private void respond(ResultReceiver reply, String error) {
        if (reply == null) return;
        Bundle result = new Bundle();
        if (error != null) result.putString("error", error);
        reply.send(error == null ? 0 : 1, result);
    }

    private void showNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "러닝 위치 기록", NotificationManager.IMPORTANCE_LOW));
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        if (open != null) builder.setContentIntent(PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        Notification notification = builder.setContentTitle("요런 · 러닝 기록 중")
            .setContentText("화면을 꺼도 위치를 저장합니다. 앱에서 일시정지 또는 종료하세요.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setOngoing(true).setOnlyAlertOnce(true).build();
        if (Build.VERSION.SDK_INT >= 29) startForeground(7001, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(7001, notification);
    }

    @Override public void onLocationChanged(Location location) {
        if (!recording || journal == null) return;
        try { journal.point(location); }
        catch (Exception error) { fail("위치를 저장하지 못해 기록을 중단했습니다. 저장 공간을 확인한 뒤 재개하세요."); }
    }

    @Override public void onProviderDisabled(String provider) {
        if (recording && LocationManager.GPS_PROVIDER.equals(provider)) {
            fail("위치 서비스가 꺼져 기록이 중단되었습니다. 위치 설정을 켠 뒤 재개하세요.");
        }
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    private void fail(String reason) {
        failure = reason;
        try {
            if (journal != null) {
                // Stop elapsed time at the last durable event, not at a later UI reopen.
                journal.recover();
                journal.error(reason);
            }
        } catch (Exception ignored) { /* The volatile failure remains visible if storage is full. */ }
        shutdown();
    }

    private void shutdown() {
        stopping = true;
        recording = false;
        if (locations != null) {
            try { locations.removeUpdates(this); } catch (SecurityException ignored) {}
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        recording = false;
        if (locations != null) {
            try { locations.removeUpdates(this); } catch (SecurityException ignored) {}
        }
        try { if (journal != null) journal.recover(); }
        catch (Exception error) { failure = "중단 상태를 저장하지 못했습니다. 저장 공간을 확인하세요."; }
        alive = false;
        stopping = false;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
