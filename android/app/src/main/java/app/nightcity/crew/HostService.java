package app.nightcity.crew;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The only component which runs the local server. Never starts from boot or silently. */
public class HostService extends Service {
    public static final String ACTION_START = "app.nightcity.crew.mobile.START_HOST";
    public static final String ACTION_STOP = "app.nightcity.crew.mobile.STOP_HOST";
    public static final String PAYLOAD_VERSION = "0.17.7-mobile.1";
    private static final String CHANNEL_ID = "night-city-table";
    private static final int NOTIFICATION_ID = 2020;
    private static final Object PYTHON_LOCK = new Object();
    private static final Object INITIAL_OWNER_LOCK = new Object();
    private static final String INITIAL_OWNER_ORIGIN = "http://127.0.0.1:8080";
    private static final long INITIAL_OWNER_COOKIE_TTL_MS = 120_000;
    // One-shot handoff to CookieManager only. Never written to preferences,
    // intents, a web message, the status indicator or the notification.
    private static String initialOwnerCookie = "";
    private static long initialOwnerCookieExpires;
    // Every service generation uses the same queue. An old teardown can never
    // run after a later accepted start and close that later server.
    private static final ExecutorService SERVER_EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile boolean starting;
    private static volatile boolean running;
    private static volatile boolean stopping;
    private static volatile String lanUrl = "";
    private static volatile String localUrl = "";
    private static volatile String error = "";
    private static volatile HostService liveInstance;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean destroyed;
    private boolean foregroundAttached;

    public static boolean isStarting() { return starting; }
    public static boolean isRunning() { return running; }
    public static boolean isStopping() { return stopping; }
    public static String getLanUrl() { return lanUrl; }
    public static String getLocalUrl() { return localUrl; }
    public static String getError() { return error; }

    public static void clearInitialOwnerCookie() {
        synchronized (INITIAL_OWNER_LOCK) {
            initialOwnerCookie = "";
            initialOwnerCookieExpires = 0;
        }
    }

    /** Consume the first-setup login only for this running local WebView origin. */
    public static String takeInitialOwnerCookie(String origin) {
        synchronized (INITIAL_OWNER_LOCK) {
            if (!running || starting || stopping || !INITIAL_OWNER_ORIGIN.equals(localUrl)
                    || SystemClock.elapsedRealtime() >= initialOwnerCookieExpires) {
                clearInitialOwnerCookie();
                return "";
            }
            if (!INITIAL_OWNER_ORIGIN.equals(origin)) return "";
            String cookie = initialOwnerCookie;
            clearInitialOwnerCookie();
            return cookie;
        }
    }

    public static PyObject bridge(Context context) {
        synchronized (PYTHON_LOCK) {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(context.getApplicationContext()));
            return Python.getInstance().getModule("mobile_host");
        }
    }

    /** Reconcile the native indicator after the recovery adapter drains and restores HTTP. */
    public static void refreshStatusAfterRecovery(Context context) throws Exception {
        clearInitialOwnerCookie();
        JSONObject state = new JSONObject(bridge(context).callAttr("status").toString());
        if (starting || stopping) return;
        running = state.optBoolean("running", false);
        localUrl = state.optString("local_url", "");
        lanUrl = state.optString("lan_url", "");
        error = state.optString("error", "");
        HostService instance = liveInstance;
        if (instance != null && !instance.destroyed) {
            if (running) instance.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,
                    instance.notification(lanUrl.isEmpty() ? "Игра работает только на этом телефоне" : "Адрес для игроков: " + lanUrl));
            else {
                instance.releaseWakeLock();
                instance.stopForeground(STOP_FOREGROUND_REMOVE);
                instance.stopSelf();
            }
        }
    }

    public static File dataDirectory(Context context) {
        return new File(context.getFilesDir(), "host-data");
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onCreate() {
        super.onCreate();
        liveInstance = this;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Игра у ведущего", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Показывает, когда этот телефон раздаёт игру по локальной сети.");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            stopHosting();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) { stopSelf(); return START_NOT_STICKY; }
        clearInitialOwnerCookie();
        if (starting || running || stopping) {
            // A repeated start on the active instance is harmless. A newly
            // created instance during old teardown must stop immediately, so it
            // cannot violate Android's foreground-start deadline.
            if (!foregroundAttached) stopSelf();
            return START_NOT_STICKY;
        }
        final String address = intent.getStringExtra("lan_host") == null ? "" : intent.getStringExtra("lan_host");
        final String username = intent.getStringExtra("admin_user") == null ? "" : intent.getStringExtra("admin_user");
        final String password = intent.getStringExtra("admin_password") == null ? "" : intent.getStringExtra("admin_password");
        intent.removeExtra("admin_password");
        starting = true;
        error = "";
        try {
            beginForeground("Подготавливаем локальную игру…");
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NightCityCrew:LocalTable");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception e) {
            starting = false;
            error = "Android не разрешил запуск сервера. Открой приложение и попробуй ещё раз.";
            releaseWakeLock();
            stopSelf();
            return START_NOT_STICKY;
        }
        SERVER_EXECUTOR.execute(() -> {
            try {
                if (destroyed) return;
                File payload = preparePayload();
                JSONObject result = new JSONObject(bridge(this).callAttr("start",
                        dataDirectory(this).getAbsolutePath(), payload.getAbsolutePath(),
                        address, username, password, 8080, true).toString());
                if (destroyed) {
                    bridge(this).callAttr("stop");
                    running = false;
                    localUrl = "";
                    lanUrl = "";
                } else {
                    running = result.optBoolean("running", false);
                    localUrl = result.optString("local_url", "");
                    lanUrl = result.optString("lan_url", "");
                    error = result.optString("error", "");
                    if (running && error.isEmpty()) error = result.optString("initial_login_warning", "");
                    synchronized (INITIAL_OWNER_LOCK) {
                        if (running && !stopping && !destroyed && liveInstance == this
                                && INITIAL_OWNER_ORIGIN.equals(localUrl)) {
                            initialOwnerCookie = result.optString("initial_session_cookie", "");
                            initialOwnerCookieExpires = initialOwnerCookie.isEmpty() ? 0
                                    : SystemClock.elapsedRealtime() + INITIAL_OWNER_COOKIE_TTL_MS;
                        }
                    }
                    result.remove("initial_session_cookie");
                }
                if (!running && error.isEmpty()) error = "Не удалось запустить локальную игру.";
            } catch (Exception e) {
                clearInitialOwnerCookie();
                running = false;
                localUrl = "";
                lanUrl = "";
                error = userError(e, "Не удалось подготовить локальный сервер.");
            } finally {
                starting = false;
            }
            if (running && !destroyed && !stopping) {
                getSystemService(NotificationManager.class).notify(NOTIFICATION_ID,
                        notification(lanUrl.isEmpty() ? "Игра работает только на этом телефоне" : "Адрес для игроков: " + lanUrl));
            } else {
                releaseWakeLock();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        });
        return START_NOT_STICKY;
    }

    private void beginForeground(String text) {
        Notification notification = notification(text);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(NOTIFICATION_ID, notification);
        foregroundAttached = true;
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, HostService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_notification).setContentTitle("Night City Crew — сервер включён")
                .setContentText(text).setContentIntent(content).setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE).setOnlyAlertOnce(true)
                .addAction(new Notification.Action.Builder(null, "Остановить сервер", stopAction).build()).build();
    }

    private void stopHosting() {
        clearInitialOwnerCookie();
        if (stopping) return;
        stopping = true;
        SERVER_EXECUTOR.execute(() -> {
            try {
                if (Python.isStarted()) bridge(this).callAttr("stop");
                error = "";
            } catch (Exception e) {
                error = userError(e, "Не удалось завершить сервер.");
            } finally {
                starting = false;
                running = false;
                stopping = false;
                lanUrl = "";
                localUrl = "";
                releaseWakeLock();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            }
        });
    }

    @Override public void onDestroy() {
        destroyed = true;
        clearInitialOwnerCookie();
        // A successful explicit stop needs no second stop. For an unexpected
        // destruction, mark teardown synchronously so UI cannot start a new
        // server while active HTTP requests are still draining.
        if (liveInstance == this && (starting || running || stopping)) {
            stopping = true;
            SERVER_EXECUTOR.execute(() -> {
                try {
                    if (Python.isStarted()) bridge(this).callAttr("stop");
                } catch (Exception ignored) {
                    // SQLite remains on disk even if Android removes the process.
                } finally {
                    starting = false;
                    running = false;
                    stopping = false;
                    lanUrl = "";
                    localUrl = "";
                    releaseWakeLock();
                }
            });
        }
        releaseWakeLock();
        super.onDestroy();
    }

    private synchronized void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private File preparePayload() throws IOException {
        return PayloadInstaller.install(getAssets().open("server.zip"), getFilesDir(), PAYLOAD_VERSION);
    }

    public static String userError(Exception error, String fallback) {
        String message = error.getMessage();
        if (message == null || message.isEmpty()) return fallback;
        // Preserve Russian backend validation without printing stack traces or paths.
        int colon = message.indexOf(": ");
        if (colon >= 0 && colon < 80) message = message.substring(colon + 2);
        return message.matches("(?s).*[А-Яа-яЁё].*") ? message : fallback;
    }
}
