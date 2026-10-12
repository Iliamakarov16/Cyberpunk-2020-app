package app.nightcity.crew;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.res.ColorStateList;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffColorFilter;
import android.graphics.Shader;
import android.graphics.drawable.StateListDrawable;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ScriptHandler;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A phone-owned server and a narrowly scoped client around the existing game UI. */
public class MainActivity extends Activity {
    private int BG, PANEL, RAISED, INK, MUTED, ACCENT, SIGNAL, LINE, DARK_INK;
    private int IDENTITY_BG, IDENTITY_INK, IDENTITY_MUTED;
    private static final String STYLE_KEY = "nc20.interface.v1";
    private static final String LOCAL_ORIGIN = "http://127.0.0.1:8080";
    private static final int PICK_FILE = 1000;
    private int pickerSerial = 0, activeFileRequest = -1;
    private WebView uploadOwner;
    private static final int SAVE_FILE = 102;
    private static final int RESTORE_FILE = 103;
    private static final int NOTIFICATION_PERMISSION = 104;
    private static final int OWNER_CREDENTIAL_CONFIRMATION = 105;
    private static final long RECOVERY_AUTHORIZATION_MS = 120000;
    private static final long DOWNLOAD_LIMIT = 25L * 1024 * 1024;
    private static final long BACKUP_LIMIT = 100L * 1024 * 1024;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LinearLayout root;
    private LinearLayout webContainer;
    private WebView webView;
    private boolean initialWebCookiePending;
    private boolean initialWebLoadIssued;
    private TextView webStatus;
    private ProgressBar webProgress;
    private String currentOrigin = "";
    private String page = "home";
    private String lastServiceState = "";
    private int nativePageGeneration;
    private boolean awaitingHost;
    private boolean activityVisible;
    private boolean battleMode;
    private int beforeBattleUi;
    private boolean nativeBackPending;
    private int nativeBackGeneration;
    private AlertDialog webExitDialog;
    private boolean taskBusy;
    private ValueCallback<Uri[]> uploadCallback;
    private File pendingExport;
    private String pendingExportName;
    private Typeface dossierBold;
    private Typeface dossierItalic;
    private Bitmap printGrain;
    private ScriptHandler pendingBootScript;
    private boolean recoveryConfirmationPending;
    private long recoveryAuthorizedUntil;
    private boolean recoveryMustBeRunning;
    private WebView recoveryRequestedView;
    private String recoveryRequestedOrigin;
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!activityVisible) return;
            String state = serviceState();
            if (awaitingHost && !HostService.isStarting() && !HostService.isStopping()
                    && (HostService.isRunning() || !HostService.getError().isEmpty())) {
                awaitingHost = false;
                lastServiceState = state;
                if (page.equals("host")) {
                    if (HostService.isRunning()) openWeb(HostService.getLocalUrl());
                    else showHostPanel();
                }
            } else if (!state.equals(lastServiceState)) {
                lastServiceState = state;
                if (page.equals("host") || page.equals("home") || page.equals("tools")) {
                    if (page.equals("host")) showHostPanel(); else if (page.equals("tools")) showToolsPanel(); else showHome();
                } else if (page.equals("web") && currentOrigin.equals("http://127.0.0.1:8080") && !HostService.isRunning()) {
                    webError("Сервер остановлен. Открой «Подключение», чтобы запустить его.");
                }
            }
            main.postDelayed(this, 1200);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        applyNativePalette();
        try {
            dossierBold = Typeface.createFromAsset(getAssets(), "fonts/Dossier-Bold.ttf");
            dossierItalic = Typeface.createFromAsset(getAssets(), "fonts/Dossier-BoldItalic.ttf");
            try (InputStream texture = getAssets().open("style-textures/photocopy-grain-v1.png")) {
                printGrain = BitmapFactory.decodeStream(texture);
            }
        } catch (Exception ignored) {
            dossierBold = Typeface.create("sans-serif-condensed", Typeface.BOLD);
            dossierItalic = Typeface.create("sans-serif-condensed", Typeface.BOLD_ITALIC);
        }
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener(this::applyRootInsets);
        setContentView(root);
        if (state != null && state.containsKey("pending_export")) {
            File recovered = new File(state.getString("pending_export", ""));
            try {
                if (recovered.getCanonicalPath().startsWith(getCacheDir().getCanonicalPath() + File.separator) && recovered.isFile()) {
                    pendingExport = recovered;
                    pendingExportName = state.getString("pending_name", "NightCity-backup.sqlite3");
                }
            } catch (Exception ignored) { }
        }
        showHome();
    }

    private WindowInsets applyRootInsets(View view, WindowInsets insets) {
        // Native padding already moves the complete WebView into the usable
        // area. Forward zero dimensions, rather than CONSUMED or the original
        // insets: the web page must receive keyboard-hide and rotation updates
        // without adding the same safe area a second time.
        if (Build.VERSION.SDK_INT >= 30) {
            int safeTypes = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
            android.graphics.Insets bars = insets.getInsets(safeTypes);
            android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(Math.max(bars.left, keyboard.left), Math.max(bars.top, keyboard.top),
                    Math.max(bars.right, keyboard.right), Math.max(bars.bottom, keyboard.bottom));
            return new WindowInsets.Builder(insets)
                    .setInsets(safeTypes | WindowInsets.Type.ime(), android.graphics.Insets.NONE)
                    .setInsetsIgnoringVisibility(safeTypes, android.graphics.Insets.NONE)
                    .setDisplayCutout(null)
                    .build();
        }
        int left = insets.getSystemWindowInsetLeft();
        int top = insets.getSystemWindowInsetTop();
        int right = insets.getSystemWindowInsetRight();
        int bottom = insets.getSystemWindowInsetBottom();
        if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
            android.view.DisplayCutout cutout = insets.getDisplayCutout();
            left = Math.max(left, cutout.getSafeInsetLeft());
            top = Math.max(top, cutout.getSafeInsetTop());
            right = Math.max(right, cutout.getSafeInsetRight());
            bottom = Math.max(bottom, cutout.getSafeInsetBottom());
        }
        // Legacy system-window dimensions include any IME avoidance supplied
        // by adjustResize; retain that root layout behavior on Android 7..10.
        view.setPadding(left, top, right, bottom);
        if (Build.VERSION.SDK_INT >= 29) {
            return new WindowInsets.Builder(insets)
                    .setSystemWindowInsets(android.graphics.Insets.NONE)
                    .setStableInsets(android.graphics.Insets.NONE)
                    .setDisplayCutout(null)
                    .build();
        }
        // Before Builder exists, replace the system-window slot (do not
        // consume it) so zero-valued notifications still reach child views.
        WindowInsets remaining = insets.replaceSystemWindowInsets(0, 0, 0, 0).consumeStableInsets();
        if (Build.VERSION.SDK_INT >= 28) remaining = remaining.consumeDisplayCutout();
        return remaining;
    }

    @Override protected void onResume() {
        super.onResume();
        activityVisible = true;
        // A keyboard/password-manager overlay can pause and resume this
        // activity. Rebuild only when the server actually changed: replacing
        // the EditTexts here discarded the user's focus and unfinished input.
        main.removeCallbacks(poll);
        main.post(poll);
        if (webView != null && page.equals("web")) { webView.onResume(); if (battleMode) applyBattleSystemBars(); }
    }

    @Override protected void onPause() {
        activityVisible = false;
        main.removeCallbacks(poll);
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (pendingExport != null) {
            state.putString("pending_export", pendingExport.getAbsolutePath());
            state.putString("pending_name", pendingExportName);
        }
        super.onSaveInstanceState(state);
    }

    @Override protected void onDestroy() {
        main.removeCallbacks(poll);
        destroyWebView();
        executor.shutdown();
        super.onDestroy();
    }

    private void showHome() {
        page = "home";
        lastServiceState = serviceState();
        LinearLayout content = nativePage(null);
        eyebrow(content, "ЛИЧНЫЙ КАНАЛ / 01");
        identity(content, "NIGHT CITY", "CREW // CYBERPUNK 2020");
        paragraph(content, "Твоя команда. Твои истории. Выбери, где начинается игра.");
        dataRow(content, "ЛОКАЛЬНАЯ ИГРА", HostService.isRunning() ? "КАНАЛ ОТКРЫТ" : "ОЖИДАЕТ ЗАПУСКА");
        dataRow(content, "ХРАНИЛИЩЕ", "НА ЭТОМ ТЕЛЕФОНЕ");
        if (HostService.isRunning()) {
            button(content, "ВОЙТИ В ЛОКАЛЬНУЮ ИГРУ →", true, () -> openWeb(HostService.getLocalUrl()));
        } else {
            button(content, "НАЧАТЬ ЛОКАЛЬНУЮ ИГРУ →", true, this::showHostPanel);
        }
        button(content, "ПОДКЛЮЧИТЬСЯ К ВЕДУЩЕМУ →", false, this::showClientPanel);
        if (webView != null && (!HostService.isRunning() || !currentOrigin.equals(HostService.getLocalUrl()))) {
            textAction(content, "Вернуться в открытую игру", this::showCachedWeb);
        }
        textAction(content, "Забыл пароль?", () -> beginOwnerRecovery(false));
        textAction(content, "Оформление и загрузка", this::showAppearancePanel);
        textAction(content, "Связь, сервер и копии данных", this::showToolsPanel);
        footer(content, "ЛОКАЛЬНАЯ СЕТЬ / ANDROID + IPHONE");
    }

    private void showToolsPanel() {
        page = "tools";
        lastServiceState = serviceState();
        LinearLayout content = nativePage("Главное меню");
        eyebrow(content, "СВЯЗЬ И ДАННЫЕ / 02");
        title(content, "За кулисами");
        dataRow(content, "СЕРВЕР", HostService.isRunning() ? "ВКЛЮЧЁН" : "ОСТАНОВЛЕН");
        button(content, "Локальная игра и сеть", true, this::showHostPanel);
        if (HostService.isRunning()) {
            String address = HostService.getLanUrl();
            if (!address.isEmpty()) {
                dataRow(content, "АДРЕС ДЛЯ ПАРТИИ", address);
                textAction(content, "Скопировать адрес", () -> copyText("Адрес игры", address));
                textAction(content, "Поделиться адресом", () -> share("Night City Crew: подключись к моей Wi-Fi сети и открой " + address));
                textAction(content, "Подключение iPhone", () -> share("Night City Crew на iPhone: открой в Safari после подключения к Wi-Fi ведущего:\n" + address + "/mobile/install-ios"));
                if (!containsLocalAddress(address)) note(content, "Сеть изменилась. Перезапусти сервер и отправь партии новый адрес.");
            } else note(content, "Сейчас доступен только этот телефон. Для партии включи Wi-Fi или точку доступа.");
        }
        button(content, "Копии и перенос данных", false, this::showBackupsPanel);
        textAction(content, "Оформление и загрузка", this::showAppearancePanel);
        textAction(content, "Забыл пароль ведущего?", () -> beginOwnerRecovery(false));
        if (HostService.isRunning()) textAction(content, "Остановить сервер", this::confirmStop);
        footer(content, "ДАННЫЕ СОХРАНЯЮТСЯ ПРИ ОБНОВЛЕНИИ APK");
    }

    private void showAppearancePanel() {
        page = "appearance";
        LinearLayout content = nativePage("Главное меню");
        eyebrow(content, "ЛИЧНЫЙ ИНТЕРФЕЙС / 03");
        title(content, "Оформление");
        paragraph(content, "Настройка доступна до входа в аккаунт и остаётся на этом телефоне.");
        final int appearanceGeneration = nativePageGeneration;
        final boolean[] choiceTouched = {false};
        CheckBox loading = new CheckBox(this);
        loading.setText("Пропускать загрузку");
        loading.setTextColor(INK);
        loading.setTextSize(16);
        loading.setButtonTintList(ColorStateList.valueOf(ACCENT));
        loading.setPadding(0, dp(12), 0, dp(12));
        loading.setMinHeight(dp(56));
        loading.setChecked(!getPreferences(MODE_PRIVATE).getBoolean("boot_enabled", true));
        content.addView(loading, fullWidth());
        loading.setOnCheckedChangeListener((view, skip) -> {
            choiceTouched[0] = true;
            getPreferences(MODE_PRIVATE).edit().putBoolean("boot_enabled", !skip).putBoolean("boot_override_pending", true).apply();
            applyPendingBootChoice(webView);
        });
        if (webView != null && !getPreferences(MODE_PRIVATE).getBoolean("boot_override_pending", false)) {
            webView.evaluateJavascript("(()=>{try{const s=JSON.parse(localStorage.getItem('" + STYLE_KEY + "')||'{}');return typeof s.bootEnabled==='boolean'?s.bootEnabled:null;}catch{return null;}})()", result -> {
                if (!page.equals("appearance") || appearanceGeneration != nativePageGeneration || choiceTouched[0]
                        || !(result.equals("true") || result.equals("false"))) return;
                boolean enabled = result.equals("true");
                loading.setOnCheckedChangeListener(null);
                loading.setChecked(!enabled);
                getPreferences(MODE_PRIVATE).edit().putBoolean("boot_enabled", enabled).apply();
                loading.setOnCheckedChangeListener((view, skip) -> {
                    choiceTouched[0] = true;
                    getPreferences(MODE_PRIVATE).edit().putBoolean("boot_enabled", !skip).putBoolean("boot_override_pending", true).apply();
                    applyPendingBootChoice(webView);
                });
            });
        }
        paragraph(content, "Включи пропуск, чтобы сразу открывать игру после входа. Сервер при этом всё равно должен получить данные.");
        note(content, "Палитры, фактуры и три вида загрузки доступны в «Оформлении» на экране входа в игру.");
        if (webView != null) button(content, "Открыть экран игры →", true, this::showCachedWeb);
        else if (HostService.isRunning()) button(content, "Открыть экран входа →", true, () -> openWeb(HostService.getLocalUrl()));
        else button(content, "Настроить локальную игру →", true, this::showHostPanel);
        footer(content, "НАСТРОЙКА НЕ МЕНЯЕТ КАМПАНИИ И ПЕРСОНАЖЕЙ");
    }

    private String bootChoiceScript() {
        boolean enabled = getPreferences(MODE_PRIVATE).getBoolean("boot_enabled", true);
        return "(()=>{try{const key='" + STYLE_KEY + "';let value=JSON.parse(localStorage.getItem(key)||'{}');"
                + "if(!value||typeof value!=='object'||Array.isArray(value))value={};value.bootEnabled=" + enabled + ";"
                + "const saved=JSON.stringify(value);localStorage.setItem(key,saved);"
                + "window.dispatchEvent(new StorageEvent('storage',{key,newValue:saved}));return true;}catch{return false;}})()";
    }

    private void applyPendingBootChoice(WebView requested) {
        if (requested == null || requested != webView
                || !getPreferences(MODE_PRIVATE).getBoolean("boot_override_pending", false)
                || !ServerAddress.sameOrigin(requested.getUrl(), currentOrigin)) return;
        final boolean applied = getPreferences(MODE_PRIVATE).getBoolean("boot_enabled", true);
        requested.evaluateJavascript(bootChoiceScript(), result -> {
            if (requested != webView || !result.equals("true")
                    || applied != getPreferences(MODE_PRIVATE).getBoolean("boot_enabled", true)) return;
            getPreferences(MODE_PRIVATE).edit().putBoolean("boot_override_pending", false).apply();
            if (pendingBootScript != null) { pendingBootScript.remove(); pendingBootScript = null; }
        });
    }

    private boolean recoveryContextAllowed() {
        if (!recoveryMustBeRunning) return true;
        return recoveryRequestedView == webView && page.equals("web")
                && LOCAL_ORIGIN.equals(recoveryRequestedOrigin)
                && LOCAL_ORIGIN.equals(currentOrigin)
                && webView != null && ServerAddress.sameOrigin(webView.getUrl(), LOCAL_ORIGIN)
                && HostService.isRunning() && !HostService.isStarting() && !HostService.isStopping();
    }

    private void beginOwnerRecovery(boolean fromWeb) {
        if (taskBusy || recoveryConfirmationPending || HostService.isStarting() || HostService.isStopping()) {
            toast("Дождись завершения текущей операции."); return;
        }
        recoveryMustBeRunning = fromWeb;
        recoveryRequestedView = fromWeb ? webView : null;
        recoveryRequestedOrigin = fromWeb ? currentOrigin : "";
        recoveryAuthorizedUntil = 0;
        if (!recoveryContextAllowed()) return;
        if (!new File(HostService.dataDirectory(this), "tracker.sqlite3").isFile()) {
            noteError("На этом телефоне пока нет аккаунта ведущего. Создай его при первом запуске локальной игры. Для аккаунта на другом телефоне обратись к его ведущему."); return;
        }
        KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (keyguard == null || !keyguard.isDeviceSecure()) {
            noteError("Для восстановления нужен PIN, пароль или графический ключ блокировки этого телефона. Настрой блокировку в Android и вернись сюда."); return;
        }
        Intent confirmation = keyguard.createConfirmDeviceCredentialIntent("Восстановить доступ", "Подтверди блокировку этого телефона, чтобы задать новый пароль ведущего Night City Crew.");
        if (confirmation == null) { noteError("Android не смог открыть подтверждение блокировки телефона."); return; }
        HostService.clearInitialOwnerCookie();
        recoveryConfirmationPending = true;
        try { startActivityForResult(confirmation, OWNER_CREDENTIAL_CONFIRMATION); }
        catch (Exception failure) {
            recoveryConfirmationPending = false;
            noteError("Не удалось открыть подтверждение Android. Пароль не изменён.");
        }
    }

    private void showOwnerRecoveryForm() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(22), dp(12), dp(22), dp(12));
        form.setBackgroundColor(PANEL);
        if (Build.VERSION.SDK_INT >= 26) form.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        paragraph(form, "Новый пароль восстановит доступ к аккаунту ведущего на этом телефоне. Персонажи и кампании сохранятся.");
        label(form, "Новый пароль — 12–256 символов");
        EditText password = input(form, "Новый пароль", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        password.setSaveEnabled(false);
        label(form, "Повтори пароль");
        EditText repeat = input(form, "Ещё раз", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        repeat.setSaveEnabled(false);
        if (Build.VERSION.SDK_INT >= 26) {
            password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            repeat.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        }
        addPasswordVisibilityToggle(form, password);
        if (HostService.isRunning()) paragraph(form, "На время восстановления сервер ненадолго закроет соединение и откроется снова. Остальные аккаунты останутся в игре.");
        ScrollView recoveryScroll = new ScrollView(this);
        recoveryScroll.setFillViewport(false);
        recoveryScroll.addView(form, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Новый пароль ведущего")
                .setView(recoveryScroll).setPositiveButton("Сохранить пароль", null).setNegativeButton("Отмена", null).create();
        dialog.setOnDismissListener(ignored -> { recoveryAuthorizedUntil = 0; password.setText(""); repeat.setText(""); });
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            if (taskBusy) return;
            if (!recoveryContextAllowed() || SystemClock.elapsedRealtime() >= recoveryAuthorizedUntil) {
                dialog.dismiss();
                noteError("Подтверждение Android истекло или локальная игра закрылась. Повтори восстановление."); return;
            }
            final String secret = password.getText().toString();
            if (!NativePasswordPolicy.valid(secret)) { password.setError("Нужно от 12 до 256 корректных символов"); return; }
            if (!secret.equals(repeat.getText().toString())) { repeat.setError("Пароли не совпадают"); return; }
            final long authorizedUntil = recoveryAuthorizedUntil;
            final boolean requireHost = recoveryMustBeRunning;
            recoveryAuthorizedUntil = 0;
            taskBusy = true;
            dialog.setCancelable(false);
            dialog.setCanceledOnTouchOutside(false);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            password.setEnabled(false); repeat.setEnabled(false);
            password.setText(""); repeat.setText("");
            executor.execute(() -> {
                try {
                    if (SystemClock.elapsedRealtime() >= authorizedUntil
                            || (requireHost && (!HostService.isRunning() || HostService.isStarting() || HostService.isStopping())))
                        throw new IllegalArgumentException("Подтверждение Android истекло. Повтори восстановление.");
                    JSONObject result = new JSONObject(HostService.bridge(this).callAttr("recover_owner_password",
                            HostService.dataDirectory(this).getAbsolutePath(), secret, true).toString());
                    try { HostService.refreshStatusAfterRecovery(this); } catch (Exception statusFailure) { }
                    main.post(() -> {
                        taskBusy = false; dialog.dismiss();
                        if (isFinishing() || isDestroyed()) return;
                        CookieManager.getInstance().setCookie(LOCAL_ORIGIN, "nightcity_session=; Max-Age=0; Path=/", unused -> {
                            if (isFinishing() || isDestroyed()) return;
                            CookieManager.getInstance().flush();
                            if (LOCAL_ORIGIN.equals(currentOrigin)) destroyWebView();
                            showHome();
                            String message = "Логин: " + result.optString("username") + "\nПароль изменён. Войди с новым паролем.";
                            if (!result.optString("error").isEmpty()) message += "\nСервер нужно запустить снова: " + result.optString("error");
                            new AlertDialog.Builder(this).setTitle("Доступ восстановлен").setMessage(message)
                                    .setPositiveButton(HostService.isRunning() ? "Открыть вход" : "К локальной игре", (done, which) -> {
                                        if (HostService.isRunning()) openWeb(HostService.getLocalUrl()); else showHostPanel();
                                    }).setNegativeButton("Закрыть", null).show();
                        });
                    });
                } catch (Exception error) {
                    try { HostService.refreshStatusAfterRecovery(this); } catch (Exception ignoredStatus) { }
                    main.post(() -> {
                        taskBusy = false; dialog.dismiss();
                        noteError(HostService.userError(error, "Не удалось восстановить доступ. Повтори подтверждение Android."));
                    });
                }
            });
        }));
        dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    }

    private void showHostPanel() {
        page = "host";
        lastServiceState = serviceState();
        LinearLayout content = nativePage("Подключение");
        final int panelGeneration = nativePageGeneration;
        eyebrow(content, "HOST // ДАННЫЕ НА ЭТОМ ТЕЛЕФОНЕ");
        title(content, "Локальная игра");
        if (HostService.isStarting() || HostService.isStopping()) {
            note(content, HostService.isStopping() ? "Останавливаем сервер…" : "Готовим файлы и запускаем сервер…");
            paragraph(content, "Данные сохраняются в памяти приложения. Не удаляй его, чтобы сохранить кампании.");
            return;
        }
        if (!HostService.getError().isEmpty()) note(content, HostService.getError());
        if (HostService.isRunning()) {
            dataRow(content, "СОСТОЯНИЕ", "КАНАЛ ОТКРЫТ");
            dataRow(content, "ИГРОКИ", HostService.getLanUrl().isEmpty() ? "ТОЛЬКО ЭТОТ ТЕЛЕФОН" : "ОБЩАЯ WI-FI СЕТЬ");
            button(content, "ОТКРЫТЬ ИГРУ →", true, () -> openWeb(HostService.getLocalUrl()));
            String address = HostService.getLanUrl();
            if (!address.isEmpty()) textAction(content, "Пригласить игроков", () -> share("Night City Crew: подключись к моей Wi-Fi сети и открой " + address));
            textAction(content, "Забыл пароль?", () -> beginOwnerRecovery(false));
            textAction(content, "Сеть, копии и управление сервером", this::showToolsPanel);
            footer(content, "СЕРВЕР РАБОТАЕТ, ПОКА ВЫ ИГРАЕТЕ");
            return;
        }
        paragraph(content, "Подключись к общей Wi-Fi сети или включи точку доступа в настройках телефона. Интернет не нужен. Игроки должны находиться в той же сети.");
        List<LanAddress> addresses = lanAddresses();
        addresses.add(new LanAddress("", "Только этот телефон — без игроков по сети"));
        LinearLayout networkOptions = new LinearLayout(this);
        networkOptions.setOrientation(LinearLayout.VERTICAL);
        networkOptions.setVisibility(View.GONE);
        textAction(content, "Сеть для игроков / изменить", () -> networkOptions.setVisibility(networkOptions.getVisibility() == View.GONE ? View.VISIBLE : View.GONE));
        content.addView(networkOptions, fullWidth());
        label(networkOptions, "Сеть для игроков");
        Spinner network = new Spinner(this);
        List<String> labels = new ArrayList<>();
        for (LanAddress address : addresses) labels.add(address.label);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, labels) {
            @Override public View getView(int position, View convert, ViewGroup parent) {
                return networkOption(getItem(position));
            }
            @Override public View getDropDownView(int position, View convert, ViewGroup parent) {
                return networkOption(getItem(position));
            }
        };
        network.setAdapter(adapter);
        network.setBackground(panelDrawable());
        network.setPadding(dp(12), dp(10), dp(12), dp(10));
        networkOptions.addView(network, fullWidth());
        textAction(networkOptions, "Обновить список сетей", this::showHostPanel);
        if (addresses.size() == 1) note(content, "Локальный IP пока не найден. Проверь Wi-Fi или точку доступа и нажми «Обновить список сетей».");
        TextView checking = note(content, "Проверяем сохранённую игру…");
        LinearLayout setup = new LinearLayout(this);
        setup.setOrientation(LinearLayout.VERTICAL);
        // First-host credentials are deliberately entered manually. Exclude
        // this form, rather than the whole app, from Samsung Pass/autofill.
        if (Build.VERSION.SDK_INT >= 26) setup.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        content.addView(setup, fullWidth());
        Button start = button(content, "Запустить сервер", true, () -> {});
        start.setEnabled(false);
        executor.execute(() -> {
            try {
                boolean first = HostService.bridge(this).callAttr("needs_setup", HostService.dataDirectory(this).getAbsolutePath()).toBoolean();
                main.post(() -> {
                    if (isFinishing() || isDestroyed() || !page.equals("host")
                            || panelGeneration != nativePageGeneration || HostService.isRunning()) return;
                    checking.setText(first ? "Первый запуск / создай аккаунт ведущего" : "Игра сохранена / можно открыть канал");
                    if (!first) textAction(setup, "Забыл пароль?", () -> beginOwnerRecovery(false));
                    EditText username = null;
                    EditText password = null;
                    if (first) {
                        label(setup, "Логин первого аккаунта");
                        username = input(setup, "gm", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
                        username.setId(View.generateViewId());
                        username.setImeOptions(EditorInfo.IME_ACTION_NEXT | EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
                        if (Build.VERSION.SDK_INT >= 26) username.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
                        username.setText("gm");
                        label(setup, "Пароль — 12–256 символов");
                        password = input(setup, "Сохрани пароль у себя", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
                        password.setId(View.generateViewId());
                        username.setNextFocusForwardId(password.getId());
                        password.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_EXTRACT_UI | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
                        password.setSaveEnabled(false);
                        if (Build.VERSION.SDK_INT >= 26) password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
                        addPasswordVisibilityToggle(setup, password);
                        paragraph(setup, "Этот пароль нужен только тебе. Игроки зарегистрируют свои аккаунты. Дальше ты создашь кампанию и пригласишь их по коду.");
                    }
                    final EditText usernameField = username;
                    final EditText passwordField = password;
                    start.setEnabled(true);
                    start.setOnClickListener(view -> {
                        String user = usernameField == null ? "" : usernameField.getText().toString().trim();
                        String secret = passwordField == null ? "" : passwordField.getText().toString();
                        if (first && (!user.matches("[A-Za-z0-9_.-]{2,40}") || !NativePasswordPolicy.valid(secret))) {
                            noteError("Логин: 2–40 латинских букв, цифр, точек, дефисов или _. Пароль: 12–256 символов.");
                            return;
                        }
                        String ip = addresses.get(network.getSelectedItemPosition()).ip;
                        startHosting(ip, user, secret);
                        if (passwordField != null) passwordField.setText("");
                    });
                    if (passwordField != null) passwordField.setOnEditorActionListener((view, action, event) -> {
                        if (action != EditorInfo.IME_ACTION_DONE) return false;
                        start.performClick();
                        return true;
                    });
                });
            } catch (Exception e) {
                main.post(() -> {
                    if (!isFinishing() && !isDestroyed() && panelGeneration == nativePageGeneration && page.equals("host")) {
                        checking.setText(HostService.userError(e, "Не удалось проверить локальную игру. Открой раздел копий данных."));
                    }
                });
            }
        });
    }

    private void startHosting(String address, String user, String password) {
        if (taskBusy) { noteError("Дождись окончания сохранения или восстановления копии."); return; }
        if (HostService.isStarting() || HostService.isRunning() || HostService.isStopping()) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION);
        }
        Intent service = new Intent(this, HostService.class).setAction(HostService.ACTION_START)
                .putExtra("lan_host", address).putExtra("admin_user", user).putExtra("admin_password", password);
        try {
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
            awaitingHost = true;
            main.postDelayed(() -> {
                if (awaitingHost && page.equals("host") && !isFinishing() && !isDestroyed()) showHostPanel();
            }, 180);
        } catch (Exception e) {
            noteError("Android не разрешил запуск. Оставь приложение открытым и попробуй ещё раз.");
        }
    }

    private void showClientPanel() {
        page = "client";
        LinearLayout content = nativePage("Подключение");
        eyebrow(content, "CLIENT // ИГРА У ВЕДУЩЕГО");
        title(content, "Подключиться к игре");
        paragraph(content, "Ведущий запускает сервер и сообщает адрес. Подключись к его Wi-Fi сети или точке доступа, затем введи адрес ниже.");
        label(content, "Адрес сервера");
        EditText address = input(content, "http://192.168.1.5:8080", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(getPreferences(MODE_PRIVATE).getString("server_endpoint", ""));
        button(content, "Открыть игру", true, () -> {
            try {
                String normalized = ServerAddress.normalize(address.getText().toString());
                getPreferences(MODE_PRIVATE).edit().putString("server_endpoint", normalized).apply();
                openWeb(normalized);
            } catch (IllegalArgumentException e) { noteError(e.getMessage()); }
        });
        note(content, "Каждый игрок входит под своим аккаунтом. Пароль первого аккаунта ведущего не нужен. Внутри приложения выбери обучение игрока, создай персонажа и подай заявку по коду кампании.");
        paragraph(content, "Сохраняется только адрес сервера. Кампания и её данные остаются на устройстве ведущего. Для сервера в интернете вводи HTTPS-адрес.");
    }

    private void showBackupsPanel() {
        page = "backups";
        LinearLayout content = nativePage("Подключение");
        eyebrow(content, "BACKUP // ПЕРЕНОС И СОХРАНЕНИЕ");
        title(content, "Копии данных ведущего");
        paragraph(content, "Полная копия содержит все аккаунты, персонажей, кампании и записи этого сервера. Сохрани её в «Файлы», чтобы перенести игру на другой телефон или собственный сервер.");
        button(content, "Сохранить полную копию", true, this::exportBackup);
        button(content, "Восстановить полную копию", false, this::chooseRestore);
        note(content, "Для сохранения копии сначала запусти локальный сервер. Для восстановления он должен быть остановлен. Файл содержит личные данные игроков — храни его у себя.");
        paragraph(content, "Для переноса одной кампании используй экспорт внутри игры. Полная копия нужна для переезда всего сервера. Обновление APK поверх этой установки сохраняет локальные данные; удаление приложения удаляет их.");
    }

    private void confirmStop() {
        new AlertDialog.Builder(this).setTitle("Остановить локальную игру?")
                .setMessage("Данные останутся на телефоне. Игроки потеряют соединение до следующего запуска сервера.")
                .setPositiveButton("Остановить", (dialog, which) -> {
                    startService(new Intent(this, HostService.class).setAction(HostService.ACTION_STOP));
                    main.postDelayed(this::showHostPanel, 180);
                })
                .setNeutralButton("Сначала сохранить копию", (dialog, which) -> exportBackup())
                .setNegativeButton("Продолжить игру", null).show();
    }

    private void exportBackup() {
        if (taskBusy) { toast("Дождись завершения текущей операции."); return; }
        if (!HostService.isRunning()) { noteError("Сначала запусти локальный сервер. Затем вернись сюда и сохрани копию."); return; }
        taskBusy = true;
        toast("Готовим копию всех данных…");
        executor.execute(() -> {
            try {
                File source = new File(HostService.bridge(this).callAttr("backup").toString());
                if (!source.isFile() || source.length() > BACKUP_LIMIT) throw new IllegalArgumentException("Полная копия слишком большая для экспорта в этой тестовой сборке (100 МБ).");
                File temp = File.createTempFile("ncc-backup-", ".sqlite3", getCacheDir());
                try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(temp)) {
                    copyLimited(input, output, BACKUP_LIMIT);
                }
                main.post(() -> {
                    taskBusy = false;
                    createDocument(temp, "NightCity-full-backup.sqlite3", "application/octet-stream");
                });
            } catch (Exception e) {
                main.post(() -> { taskBusy = false; noteError(HostService.userError(e, "Не удалось создать копию. Данные игры сохранены на телефоне.")); });
            }
        });
    }

    private void chooseRestore() {
        if (taskBusy) { toast("Дождись завершения текущей операции."); return; }
        if (HostService.isRunning() || HostService.isStarting() || HostService.isStopping()) {
            noteError("Сначала останови локальный сервер. Восстановление меняет все его данные.");
            return;
        }
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try { startActivityForResult(picker, RESTORE_FILE); } catch (Exception e) { noteError("На телефоне недоступен выбор файла."); }
    }

    private void confirmRestore(Uri uri) {
        new AlertDialog.Builder(this).setTitle("Восстановить весь сервер из копии?")
                .setMessage("Текущие аккаунты, персонажи и кампании будут заменены содержимым файла. Открытый экран игры и несохранённые изменения будут закрыты. Старая база автоматически сохранится во внутренней папке резервных копий. Лучше сначала экспортировать её отдельно.")
                .setPositiveButton("Восстановить", (dialog, which) -> restore(uri))
                .setNegativeButton("Отмена", null).show();
    }

    private void restore(Uri uri) {
        if (taskBusy || HostService.isRunning() || HostService.isStarting() || HostService.isStopping()) {
            noteError("Для восстановления сервер должен быть остановлен."); return;
        }
        taskBusy = true;
        toast("Проверяем и восстанавливаем копию…");
        executor.execute(() -> {
            File temp = null;
            try {
                temp = File.createTempFile("ncc-restore-", ".sqlite3", getCacheDir());
                try (InputStream input = getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(temp)) {
                    if (input == null) throw new IllegalArgumentException("Не удалось открыть выбранный файл.");
                    copyLimited(input, output, BACKUP_LIMIT);
                }
                String message = HostService.bridge(this).callAttr("restore", HostService.dataDirectory(this).getAbsolutePath(), temp.getAbsolutePath()).toString();
                main.post(() -> {
                    taskBusy = false;
                    if (isFinishing() || isDestroyed()) return;
                    destroyWebView();
                    CookieManager.getInstance().removeAllCookies(null);
                    CookieManager.getInstance().flush();
                    showBackupsPanel();
                    new AlertDialog.Builder(this).setTitle("Копия восстановлена")
                            .setMessage(message + "\nТеперь запусти сервер и войди с логином и паролем из этой копии.")
                            .setPositiveButton("К серверу", (dialog, which) -> showHostPanel()).setNegativeButton("Закрыть", null).show();
                });
            } catch (Exception e) {
                main.post(() -> { taskBusy = false; noteError(HostService.userError(e, "Не удалось восстановить копию. Проверь, что выбран полный файл .sqlite3.")); });
            } finally { if (temp != null) temp.delete(); }
        });
    }

    private void openWeb(String endpoint) {
        if (endpoint == null || endpoint.isEmpty()) { showHostPanel(); return; }
        String requested = ServerAddress.normalize(endpoint);
        if (webView != null && requested.equals(currentOrigin)) { showCachedWeb(); return; }
        if (webView != null) {
            new AlertDialog.Builder(this).setTitle("Подключиться к другому серверу?")
                    .setMessage("Открытый экран будет закрыт. Сначала сохрани изменения внутри игры, если они ещё не сохранены.")
                    .setPositiveButton("Сменить сервер", (dialog, which) -> { destroyWebView(); openWeb(requested); })
                    .setNegativeButton("Вернуться в игру", (dialog, which) -> showCachedWeb()).show();
            return;
        }
        currentOrigin = requested;
        page = "web";
        root.removeAllViews();
        webContainer = new LinearLayout(this);
        webContainer.setOrientation(LinearLayout.VERTICAL);
        // The web game owns its header and navigation. Native connection
        // controls are requested through its menu, rather than a second bar.
        webProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        webProgress.setMax(100);
        webContainer.addView(webProgress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));
        webStatus = text("", 13, MUTED);
        webStatus.setPadding(dp(14), dp(5), dp(14), dp(5));
        webStatus.setMinimumHeight(dp(48));
        webStatus.setVisibility(View.GONE);
        webStatus.setOnClickListener(view -> returnToConnection());
        webStatus.setContentDescription("Ошибка соединения. Открыть подключение к серверу.");
        webContainer.addView(webStatus, fullWidth());
        webView = new WebView(this);
        initialWebCookiePending = false;
        initialWebLoadIssued = false;
        webView.setBackgroundColor(BG);
        // Account fields in the game have their own password-visibility
        // control. Avoid a native autofill activity taking focus while typing.
        if (Build.VERSION.SDK_INT >= 26) webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // ACTION_OPEN_DOCUMENT grants access only to files explicitly picked by
        // the user. Top-level content:// navigation remains blocked below.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        final String acceptedOrigin = currentOrigin;
        if (getPreferences(MODE_PRIVATE).getBoolean("boot_override_pending", false)
                && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            pendingBootScript = WebViewCompat.addDocumentStartJavaScript(webView, bootChoiceScript(), Collections.singleton(acceptedOrigin));
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "NightCityNative", Collections.singleton(acceptedOrigin),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        // Cached pages and replaced WebViews cannot change the
                        // currently visible native screen in the background.
                        if (view != webView || !page.equals("web") || !activityVisible) return;
                        String payload;
                        try { payload = message.getData(); }
                        catch (IllegalStateException unsupportedMessage) { return; }
                        NativeGameCommands.Command command = NativeGameCommands.parse(payload,
                                sourceOrigin == null ? "" : sourceOrigin.toString(), view.getUrl(), acceptedOrigin, isMainFrame);
                        if (command == NativeGameCommands.Command.CONNECTION) returnToConnection();
                        else if (command == NativeGameCommands.Command.RELOAD) confirmWebReload(view, acceptedOrigin);
                        else if (command == NativeGameCommands.Command.BATTLE_ENTER) setBattleMode(true);
                        else if (command == NativeGameCommands.Command.BATTLE_EXIT) setBattleMode(false);
                        else if (command == NativeGameCommands.Command.RECOVER_ACCOUNT) beginOwnerRecovery(true);
                        else if (command == NativeGameCommands.Command.BOOT_ENABLED || command == NativeGameCommands.Command.BOOT_DISABLED) {
                            if (!getPreferences(MODE_PRIVATE).getBoolean("boot_override_pending", false)) {
                                getPreferences(MODE_PRIVATE).edit().putBoolean("boot_enabled", command == NativeGameCommands.Command.BOOT_ENABLED).apply();
                            }
                        } else {
                            String palette = NativeGameCommands.paletteName(command);
                            if (palette != null) {
                                getPreferences(MODE_PRIVATE).edit().putString("palette", palette).apply();
                                applyNativePalette();
                            }
                        }
                    });
            WebViewCompat.addWebMessageListener(webView, "NightCityDownload", Collections.singleton(acceptedOrigin),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame || !ServerAddress.sameOrigin(sourceOrigin.toString(), acceptedOrigin)
                                || !ServerAddress.sameOrigin(view.getUrl(), acceptedOrigin)) return;
                        String payload = message.getData();
                        if (payload == null || payload.length() > DOWNLOAD_LIMIT * 4 / 3 + 16384) {
                            noteError("Файл слишком большой. Лимит экспорта из игры — 25 МБ."); return;
                        }
                        receiveDownload(payload);
                    });
        }
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return !ServerAddress.sameOrigin(request.getUrl().toString(), acceptedOrigin);
                return handleNavigation(request.getUrl().toString(), acceptedOrigin, request.hasGesture());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url, acceptedOrigin, true);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (ServerAddress.sameOrigin(url, acceptedOrigin)) {
                    CookieManager.getInstance().flush();
                    applyPendingBootChoice(view);
                    view.evaluateJavascript(downloadScript(), null);
                    view.evaluateJavascript("if(window.top===window&&window.NightCityNative){window.dispatchEvent(new Event('night-city-native-ready'));}", null);
                }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                webError("Не удалось проверить сертификат сервера. Используй корректный HTTPS-адрес или локальный IP.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) webError("Нет связи с ведущим. Проверь, что сервер включён и вы в одной Wi-Fi сети. Затем нажми «Подключение».");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (Build.VERSION.SDK_INT >= 26) {
                    destroyWebView();
                    returnToConnection();
                    noteError("Android перезапустил экран игры. Подключись снова — данные остались на сервере.");
                    return true;
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (webProgress != null) { webProgress.setProgress(value); webProgress.setVisibility(value == 100 ? View.GONE : View.VISIBLE); }
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                cancelFilePicker();
                if (view != webView) { callback.onReceiveValue(null); return true; }
                uploadCallback = callback; uploadOwner = view;
                activeFileRequest = PICK_FILE + (++pickerSerial % 60000);
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                String[] accept = FilePickerMime.normalize(params.getAcceptTypes());
                if (accept.length == 1) picker.setType(accept[0]);
                else if (accept.length > 1) picker.putExtra(Intent.EXTRA_MIME_TYPES, accept);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(picker, activeFileRequest); }
                catch (Exception e) { cancelFilePicker(); noteError("На телефоне недоступен выбор файла."); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mime, length) -> {
            if (url.startsWith("blob:")) {
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    webView.evaluateJavascript("window.__nccSaveBlob&&window.__nccSaveBlob(" + JSONObject.quote(url) + ",\"NightCity-export.json\")", null);
                } else noteError("Обнови Android System WebView, чтобы сохранять файлы из игры. Полную копию можно сохранить через меню подключения.");
            } else if (ServerAddress.sameOrigin(url, acceptedOrigin)) {
                downloadHttp(url, mime, userAgent);
            }
        });
        webContainer.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(webContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        final WebView openingView = webView;
        final String openingOrigin = currentOrigin;
        String initialCookie = HostService.takeInitialOwnerCookie(openingOrigin);
        if (initialCookie == null || initialCookie.isEmpty()) loadInitialWebPage(openingView, openingOrigin);
        else {
            initialWebCookiePending = true;
            CookieManager.getInstance().setCookie(openingOrigin, initialCookie, installed -> {
                CookieManager.getInstance().flush();
                if (openingView != webView || !openingOrigin.equals(currentOrigin)) return;
                initialWebCookiePending = false;
                if (!Boolean.TRUE.equals(installed)) toast("Аккаунт создан. Войди с выбранным логином и паролем.");
                // Back may cache this WebView while CookieManager is working.
                // Complete its first load once, without replacing the cached view.
                loadInitialWebPage(openingView, openingOrigin);
            });
        }
    }

    private void loadInitialWebPage(WebView requested, String origin) {
        if (requested != webView || !origin.equals(currentOrigin) || initialWebLoadIssued
                || initialWebCookiePending) return;
        if (LOCAL_ORIGIN.equals(origin) && (!HostService.isRunning()
                || !origin.equals(HostService.getLocalUrl()))) return;
        initialWebLoadIssued = true;
        requested.loadUrl(origin + "/");
    }

    private void showCachedWeb() {
        if (webView == null || webContainer == null) { showHome(); return; }
        page = "web";
        root.removeAllViews();
        root.addView(webContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        loadInitialWebPage(webView, currentOrigin);
        webView.onResume();
        webView.evaluateJavascript("if(window.top===window&&window.NightCityNative){window.dispatchEvent(new Event('night-city-native-ready'));}", null);
    }

    private boolean handleNavigation(String url, String origin, boolean gesture) {
        if (ServerAddress.sameOrigin(url, origin)) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (gesture && ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme))) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
            catch (Exception e) { toast("На телефоне нет приложения для этой ссылки."); }
        }
        return true;
    }

    private void returnToConnection() {
        if (currentOrigin.equals("http://127.0.0.1:8080")) showHostPanel(); else showHome();
    }

    private void confirmWebReload(WebView requestedView, String acceptedOrigin) {
        new AlertDialog.Builder(this).setTitle("Перезагрузить экран?")
                .setMessage("Несохранённые изменения будут потеряны. Сначала сохрани их внутри игры.")
                .setPositiveButton("Перезагрузить", (dialog, which) -> {
                    // The user may have changed servers while the dialog was
                    // open. Never reload a different game on an old request.
                    if (requestedView != webView || !page.equals("web") || !activityVisible
                            || !ServerAddress.sameOrigin(currentOrigin, acceptedOrigin)
                            || !ServerAddress.sameOrigin(requestedView.getUrl(), acceptedOrigin)) return;
                    if (webStatus != null) webStatus.setVisibility(View.GONE);
                    requestedView.reload();
                }).setNegativeButton("Отмена", null).show();
    }

    private void webError(String message) {
        if (webStatus != null) {
            webStatus.setText(message + "\nОткрыть подключение ›");
            webStatus.setContentDescription(message + ". Открыть подключение к серверу.");
            webStatus.setVisibility(View.VISIBLE);
        }
    }

    private String downloadScript() {
        return "(function(){if(window.top!==window||window.__nccDownloadInstalled||!window.NightCityDownload)return;"
                + "window.__nccDownloadInstalled=true;window.__nccSaveBlob=async function(url,name){try{"
                + "if(!url.startsWith('blob:'))return;const r=await fetch(url);const b=await r.blob();"
                + "if(b.size>26214400){alert('Лимит экспорта — 25 МБ.');return;}"
                + "const f=new FileReader();f.onload=function(){window.NightCityDownload.postMessage(JSON.stringify({"
                + "name:name||'NightCity-export.json',mime:b.type||'application/octet-stream',data:String(f.result).split(',')[1]}));};f.readAsDataURL(b);"
                + "}catch(e){alert('Не удалось подготовить файл. Попробуй экспорт ещё раз.');}};"
                + "const originalClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){"
                + "if(this.hasAttribute('download')&&this.href.startsWith('blob:')){window.__nccSaveBlob(this.href,this.download);return;}"
                + "return originalClick.call(this);};"
                + "document.addEventListener('click',function(e){const a=e.target.closest&&e.target.closest('a[download]');"
                + "if(a&&a.href.startsWith('blob:')){e.preventDefault();window.__nccSaveBlob(a.href,a.download);}},true);})();";
    }

    private void receiveDownload(String payload) {
        if (taskBusy || pendingExport != null) { toast("Заверши сохранение предыдущего файла."); return; }
        try {
            JSONObject data = new JSONObject(payload);
            String base64 = data.getString("data");
            if (base64.length() > DOWNLOAD_LIMIT * 4 / 3 + 8) throw new IllegalArgumentException();
            String filename = safeFilename(data.optString("name", "NightCity-export.json"));
            String mime = safeMime(data.optString("mime", "application/octet-stream"));
            taskBusy = true;
            executor.execute(() -> {
                try {
                    byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                    if (bytes.length > DOWNLOAD_LIMIT) throw new IllegalArgumentException();
                    File file = File.createTempFile("ncc-export-", ".tmp", getCacheDir());
                    try (OutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                    main.post(() -> { taskBusy = false; createDocument(file, filename, mime); });
                } catch (Exception e) {
                    main.post(() -> { taskBusy = false; noteError("Не удалось подготовить файл для сохранения."); });
                }
            });
        } catch (Exception e) { noteError("Не удалось прочитать экспорт. Повтори сохранение в игре."); }
    }

    private void downloadHttp(String url, String mime, String userAgent) {
        if (taskBusy || pendingExport != null) { toast("Заверши сохранение предыдущего файла."); return; }
        String cookies = CookieManager.getInstance().getCookie(url);
        String origin = currentOrigin;
        taskBusy = true;
        executor.execute(() -> {
            HttpURLConnection connection = null;
            File file = null;
            try {
                if (!ServerAddress.sameOrigin(url, origin)) throw new IllegalArgumentException();
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                if (cookies != null) connection.setRequestProperty("Cookie", cookies);
                if (userAgent != null) connection.setRequestProperty("User-Agent", userAgent);
                if (connection.getResponseCode() != 200 || connection.getContentLengthLong() > DOWNLOAD_LIMIT) throw new IllegalArgumentException();
                file = File.createTempFile("ncc-download-", ".tmp", getCacheDir());
                try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(file)) {
                    copyLimited(input, output, DOWNLOAD_LIMIT);
                }
                File ready = file;
                String last = Uri.parse(url).getLastPathSegment();
                String filename = safeFilename(last == null ? "NightCity-export" : last);
                String finalMime = safeMime(mime);
                main.post(() -> { taskBusy = false; createDocument(ready, filename, finalMime); });
            } catch (Exception e) {
                if (file != null) file.delete();
                main.post(() -> { taskBusy = false; noteError("Не удалось скачать файл. Проверь соединение; лимит — 25 МБ."); });
            } finally { if (connection != null) connection.disconnect(); }
        });
    }

    private void createDocument(File file, String filename, String mime) {
        if (isFinishing() || isDestroyed()) { file.delete(); return; }
        if (pendingExport != null) { file.delete(); toast("Заверши сохранение предыдущего файла."); return; }
        pendingExport = file;
        pendingExportName = safeFilename(filename);
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(safeMime(mime)).putExtra(Intent.EXTRA_TITLE, pendingExportName);
        try { startActivityForResult(save, SAVE_FILE); }
        catch (Exception e) { pendingExport.delete(); pendingExport = null; noteError("На телефоне недоступен выбор папки для сохранения."); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OWNER_CREDENTIAL_CONFIRMATION) {
            boolean pending = recoveryConfirmationPending;
            recoveryConfirmationPending = false;
            if (!pending || isFinishing() || isDestroyed()) return;
            if (resultCode != RESULT_OK) { recoveryAuthorizedUntil = 0; toast("Восстановление отменено."); return; }
            if (!recoveryContextAllowed()) { recoveryAuthorizedUntil = 0; return; }
            recoveryAuthorizedUntil = SystemClock.elapsedRealtime() + RECOVERY_AUTHORIZATION_MS;
            showOwnerRecoveryForm();
        } else if (requestCode >= PICK_FILE && requestCode < PICK_FILE + 60000) {
            if (requestCode != activeFileRequest || uploadCallback == null) return;
            if (uploadOwner != webView) { cancelFilePicker(); return; }
            Uri[] selected = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = Math.min(data.getClipData().getItemCount(), 20);
                    selected = new Uri[count];
                    for (int i = 0; i < count; i++) selected[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) selected = new Uri[]{data.getData()};
            }
            ValueCallback<Uri[]> callback = uploadCallback;
            uploadCallback = null; uploadOwner = null; activeFileRequest = -1;
            callback.onReceiveValue(selected);
        } else if (requestCode == SAVE_FILE) {
            File source = pendingExport;
            pendingExport = null;
            if (source == null) { toast("Повтори экспорт файла в приложении."); return; }
            if (resultCode != RESULT_OK || data == null || data.getData() == null) { source.delete(); return; }
            Uri target = data.getData();
            taskBusy = true;
            executor.execute(() -> {
                try (InputStream input = new FileInputStream(source); OutputStream output = getContentResolver().openOutputStream(target, "wt")) {
                    if (output == null) throw new IllegalArgumentException();
                    copyLimited(input, output, BACKUP_LIMIT);
                    main.post(() -> { taskBusy = false; toast("Файл сохранён."); });
                } catch (Exception e) {
                    main.post(() -> { taskBusy = false; noteError("Не удалось записать файл. Повтори экспорт и выбери другую папку."); });
                } finally { source.delete(); }
            });
        } else if (requestCode == RESTORE_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            confirmRestore(data.getData());
        }
    }

    private static void copyLimited(InputStream input, OutputStream output, long limit) throws Exception {
        byte[] buffer = new byte[32768];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new IllegalArgumentException("Выбранный файл больше допустимого размера.");
            output.write(buffer, 0, count);
        }
    }

    private static String safeFilename(String value) {
        String clean = value == null ? "" : value.replaceAll("[\\\\/\\p{Cntrl}:*?\"<>|]", "_").trim();
        while (clean.startsWith(".")) clean = clean.substring(1);
        if (clean.isEmpty()) clean = "NightCity-export.json";
        return clean.length() > 120 ? clean.substring(0, 120) : clean;
    }

    private static String safeMime(String value) {
        return value != null && value.matches("[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+") ? value : "application/octet-stream";
    }

    private LinearLayout nativePage(String backLabel) {
        nativeBackPending = false; nativeBackGeneration++;
        setBattleMode(false);
        nativePageGeneration++;
        applyNativePalette();
        if (webView != null) webView.onPause();
        root.removeAllViews();
        LinearLayout strip = new LinearLayout(this);
        strip.setGravity(Gravity.CENTER_VERTICAL);
        strip.setPadding(dp(20), dp(12), dp(20), dp(11));
        strip.setBackground(new DossierPanelDrawable(RAISED, ACCENT, 12));
        TextView brand = text("NC", 30, ACCENT);
        brand.setTypeface(dossierBold);
        strip.addView(brand);
        TextView crew = text(" / CREW", 12, INK);
        crew.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        strip.addView(crew);
        TextView version = text(HostService.PAYLOAD_VERSION, 11, MUTED);
        version.setTypeface(Typeface.MONOSPACE);
        version.setGravity(Gravity.END);
        strip.addView(version, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        root.addView(strip, fullWidth());
        if (backLabel != null) {
            Button back = compactButton("← Главный экран", "Вернуться на главный экран приложения", this::showHome);
            back.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
            root.addView(back, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        }
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(22), dp(24), dp(22), dp(32));
        content.setBackground(new DossierPanelDrawable(PANEL, BG, 8));
        scroll.addView(content, fullWidth());
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        return content;
    }

    private void applyNativePalette() {
        NativePalette colors = NativePalette.from(getPreferences(MODE_PRIVATE).getString("palette", "carmine"));
        BG = colors.background; PANEL = colors.surface; RAISED = colors.raised;
        INK = colors.text; MUTED = colors.muted; ACCENT = colors.accent;
        SIGNAL = colors.signal; LINE = colors.line; DARK_INK = colors.deep;
        IDENTITY_BG = colors.identityBackground; IDENTITY_INK = colors.identityText;
        IDENTITY_MUTED = colors.identityMuted;
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        if (root != null) root.setBackgroundColor(BG);
        if (webView != null) webView.setBackgroundColor(BG);
    }

    private void identity(LinearLayout parent, String name, String subtitle) {
        LinearLayout plate = new LinearLayout(this);
        plate.setOrientation(LinearLayout.VERTICAL);
        plate.setPadding(dp(17), dp(18), dp(17), dp(18));
        plate.setBackground(new DossierPanelDrawable(IDENTITY_BG, ACCENT, 24));
        TextView index = text("ПОДКЛЮЧЕНИЕ К ЛИЧНОМУ КАНАЛУ", 10, IDENTITY_MUTED);
        index.setTypeface(Typeface.MONOSPACE);
        plate.addView(index);
        TextView title = text(name, 54, IDENTITY_INK);
        title.setTypeface(dossierItalic);
        title.setLineSpacing(0, 0.88f);
        title.setPadding(0, dp(12), 0, dp(8));
        plate.addView(title);
        TextView detail = text(subtitle, 12, IDENTITY_MUTED);
        detail.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        plate.addView(detail);
        parent.addView(plate, fullWidth());
    }

    private void dataRow(LinearLayout parent, String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        row.setPadding(0, dp(11), 0, dp(12));
        TextView caption = text(label, 10, MUTED);
        caption.setTypeface(Typeface.MONOSPACE);
        caption.setLetterSpacing(0.05f);
        row.addView(caption);
        TextView data = text(value, 14, SIGNAL);
        data.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        data.setTextIsSelectable(true);
        row.addView(data);
        parent.addView(row, fullWidth());
        View rule = new View(this);
        rule.setBackgroundColor(LINE);
        parent.addView(rule, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));
    }

    private void footer(LinearLayout parent, String value) {
        TextView footer = text("▥  " + value, 10, MUTED);
        footer.setTypeface(Typeface.MONOSPACE);
        footer.setPadding(0, dp(22), 0, dp(6));
        parent.addView(footer, fullWidth());
    }

    private TextView networkOption(String value) {
        TextView option = text(value, 14, INK);
        option.setTypeface(Typeface.MONOSPACE);
        option.setBackgroundColor(PANEL);
        option.setPadding(dp(12), dp(12), dp(12), dp(12));
        option.setMinHeight(dp(48));
        return option;
    }

    private void textAction(LinearLayout parent, String value, Runnable action) {
        Button control = compactButton(value + "  →", value, action);
        control.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        control.setPadding(0, dp(12), 0, dp(12));
        parent.addView(control, fullWidth());
    }

    private final class DossierPanelDrawable extends GradientDrawable {
        private final Paint grain = new Paint();
        DossierPanelDrawable(int color, int border, int grainAlpha) {
            setColor(color);
            setStroke(dp(1), border);
            setCornerRadius(0);
            if (printGrain != null) {
                BitmapShader shader = new BitmapShader(printGrain, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT);
                Matrix scale = new Matrix();
                float ratio = dp(620) / (float) printGrain.getWidth();
                scale.setScale(ratio, ratio);
                shader.setLocalMatrix(scale);
                grain.setShader(shader);
                grain.setColorFilter(new PorterDuffColorFilter(INK, PorterDuff.Mode.SRC_IN));
                grain.setAlpha(grainAlpha);
            }
        }
        @Override public void draw(Canvas canvas) {
            super.draw(canvas);
            if (grain.getShader() != null) canvas.drawRect(getBounds(), grain);
        }
    }

    private void cancelFilePicker() {
        ValueCallback<Uri[]> callback = uploadCallback;
        uploadCallback = null; uploadOwner = null; activeFileRequest = -1;
        if (callback != null) callback.onReceiveValue(null);
    }

    private void destroyWebView() {
        cancelFilePicker();
        setBattleMode(false);
        nativeBackGeneration++; nativeBackPending = false;
        initialWebCookiePending = false;
        initialWebLoadIssued = false;
        if (pendingBootScript != null) { pendingBootScript.remove(); pendingBootScript = null; }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            if (webView.getParent() instanceof ViewGroup) ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        webStatus = null;
        webProgress = null;
        webContainer = null;
    }

    private TextView text(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setLineSpacing(dp(3), 1);
        return text;
    }

    private void eyebrow(LinearLayout parent, String value) {
        TextView text = text(value, 10, SIGNAL);
        text.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        text.setLetterSpacing(0.08f);
        text.setPadding(0, 0, 0, dp(15));
        parent.addView(text);
    }

    private void title(LinearLayout parent, String value) {
        TextView text = text(value, 29, INK);
        text.setTypeface(dossierItalic);
        text.setTextSize(38);
        text.setPadding(0, 0, 0, dp(16));
        parent.addView(text);
    }

    private void paragraph(LinearLayout parent, String value) {
        TextView text = text(value, 16, MUTED);
        text.setPadding(0, dp(9), 0, dp(17));
        parent.addView(text);
    }

    private TextView note(LinearLayout parent, String value) {
        TextView text = text(value, 15, INK);
        text.setBackground(panelDrawable());
        text.setPadding(dp(14), dp(14), dp(14), dp(14));
        LinearLayout.LayoutParams layout = fullWidth();
        layout.topMargin = dp(12);
        layout.bottomMargin = dp(14);
        parent.addView(text, layout);
        return text;
    }

    private void label(LinearLayout parent, String value) {
        TextView text = text(value, 14, INK);
        text.setPadding(0, dp(12), 0, dp(8));
        parent.addView(text);
    }

    private EditText input(LinearLayout parent, String hint, int type) {
        EditText input = new EditText(this);
        input.setTextColor(INK);
        input.setHintTextColor(MUTED);
        input.setTextSize(16);
        input.setTypeface(Typeface.MONOSPACE);
        input.setSingleLine(true);
        input.setInputType(type);
        input.setHint(hint);
        input.setBackground(panelDrawable());
        input.setPadding(dp(14), dp(14), dp(14), dp(14));
        parent.addView(input, fullWidth());
        return input;
    }

    private void addPasswordVisibilityToggle(LinearLayout parent, EditText password) {
        final boolean[] visible = {false};
        Button toggle = button(parent, "Показать пароль", false, () -> {});
        // Keep focus and the keyboard on the existing field when tapped. Its
        // inputType never changes, so the IME isn't restarted on every toggle.
        toggle.setFocusable(false);
        toggle.setFocusableInTouchMode(false);
        toggle.setContentDescription("Показать введённый пароль");
        toggle.setOnClickListener(view -> {
            int start = password.getSelectionStart();
            int end = password.getSelectionEnd();
            visible[0] = !visible[0];
            password.setTransformationMethod(visible[0] ? null : PasswordTransformationMethod.getInstance());
            int length = password.length();
            if (start >= 0 && end >= 0) password.setSelection(Math.min(start, length), Math.min(end, length));
            toggle.setText(visible[0] ? "Скрыть пароль" : "Показать пароль");
            toggle.setContentDescription(visible[0] ? "Скрыть введённый пароль" : "Показать введённый пароль");
        });
    }

    private String serviceState() {
        return HostService.isStarting() + ":" + HostService.isRunning() + ":" + HostService.isStopping()
                + ":" + HostService.getLanUrl() + ":" + HostService.getError();
    }

    private Button button(LinearLayout parent, String value, boolean primary, Runnable action) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled}, new int[]{}}, new int[]{MUTED, primary ? DARK_INK : INK}));
        button.setTextSize(21);
        button.setTypeface(dossierBold);
        button.setAllCaps(false);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        button.setMinHeight(dp(60));
        button.setPadding(dp(16), dp(15), dp(16), dp(15));
        button.setStateListAnimator(null);
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{-android.R.attr.state_enabled}, new DossierPanelDrawable(PANEL, LINE, 8));
        states.addState(new int[]{android.R.attr.state_pressed}, new DossierPanelDrawable(primary ? ACCENT : RAISED, ACCENT, 12));
        states.addState(new int[]{}, new DossierPanelDrawable(primary ? ACCENT : PANEL, primary ? ACCENT : LINE, primary ? 24 : 8));
        button.setBackground(states);
        button.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams layout = fullWidth();
        layout.topMargin = dp(12);
        layout.bottomMargin = dp(3);
        parent.addView(button, layout);
        return button;
    }

    private Button compactButton(String value, String description, Runnable action) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextSize(14);
        button.setTypeface(Typeface.MONOSPACE);
        button.setTextColor(INK);
        button.setAllCaps(false);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription(description);
        button.setMinHeight(dp(48));
        button.setPadding(dp(10), dp(8), dp(10), dp(8));
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private GradientDrawable panelDrawable() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(PANEL);
        drawable.setStroke(dp(1), LINE);
        drawable.setCornerRadius(0);
        return drawable;
    }

    private LinearLayout.LayoutParams fullWidth() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private void noteError(String message) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this).setTitle("Night City Crew").setMessage(message).setPositiveButton("Понятно", null).show();
    }

    private void copyText(String label, String value) {
        ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText(label, value));
        toast("Адрес скопирован.");
    }

    private void share(String value) {
        Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value);
        startActivity(Intent.createChooser(intent, "Передать адрес игры"));
    }

    private static class LanAddress {
        final String ip;
        final String label;
        LanAddress(String ip, String label) { this.ip = ip; this.label = label; }
    }

    private List<LanAddress> lanAddresses() {
        List<LanAddress> result = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> values = network.getInetAddresses();
                while (values.hasMoreElements()) {
                    InetAddress address = values.nextElement();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()
                            || !address.isSiteLocalAddress()) continue;
                    String ip = address.getHostAddress();
                    if (ip != null && ServerAddress.isPrivateIpv4(ip)) result.add(new LanAddress(ip, ip + " · " + network.getName()));
                }
            }
        } catch (Exception ignored) { }
        Collections.sort(result, (first, second) -> Integer.compare(networkPriority(first.label), networkPriority(second.label)));
        return result;
    }

    private int networkPriority(String label) {
        String name = label.toLowerCase(Locale.ROOT);
        if (name.contains("wlan") || name.contains("swlan") || name.contains("ap0")) return 0;
        if (name.contains("eth")) return 1;
        if (name.contains("rmnet") || name.contains("tun") || name.contains("ppp")) return 3;
        return 2;
    }

    private boolean containsLocalAddress(String url) {
        String host = Uri.parse(url).getHost();
        for (LanAddress address : lanAddresses()) if (address.ip.equals(host)) return true;
        return false;
    }

    private void setBattleMode(boolean enabled) {
        if (enabled && (!page.equals("web") || webView == null)) return;
        if (battleMode == enabled) { if (enabled) applyBattleSystemBars(); return; }
        if (enabled) beforeBattleUi = getWindow().getDecorView().getSystemUiVisibility();
        battleMode = enabled;
        setRequestedOrientation(enabled ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (enabled) applyBattleSystemBars();
        else if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.show(WindowInsets.Type.systemBars());
        } else getWindow().getDecorView().setSystemUiVisibility(beforeBattleUi);
        if (root != null) root.requestApplyInsets();
    }

    private void applyBattleSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void dispatchAppBack() {
        final WebView target = webView;
        if (nativeBackPending) return;
        if (target == null || !ServerAddress.sameOrigin(target.getUrl(), currentOrigin)) {
            confirmAppExit(); return;
        }
        final int generation = ++nativeBackGeneration;
        nativeBackPending = true;
        target.evaluateJavascript(NativeBackDispatch.script(), reply -> {
            if (generation != nativeBackGeneration || target != webView || !page.equals("web")) return;
            nativeBackPending = false;
            nativeBackGeneration++;
            if (!NativeBackDispatch.handled(reply)) confirmAppExit();
        });
        main.postDelayed(() -> {
            if (generation == nativeBackGeneration && nativeBackPending && target == webView && page.equals("web")) {
                nativeBackPending = false; nativeBackGeneration++; confirmAppExit();
            }
        }, 1500);
    }

    private void confirmAppExit() {
        if (isFinishing() || webExitDialog != null && webExitDialog.isShowing()) return;
        webExitDialog = new AlertDialog.Builder(this).setTitle("Закрыть приложение?")
                .setMessage("Экран игры закроется. Несохранённые черновики будут потеряны. Локальный сервер продолжит работать, если он включён.")
                .setPositiveButton("Закрыть", (dialog, which) -> finish())
                .setNegativeButton("Остаться", null).create();
        webExitDialog.show();
    }

    @Override public void onBackPressed() {
        if (page.equals("web")) {
            dispatchAppBack();
        } else if (!page.equals("home")) showHome();
        else if (webView != null) {
            new AlertDialog.Builder(this).setTitle("Закрыть экран приложения?")
                    .setMessage("Несохранённые изменения в открытой игре будут потеряны. Сначала сохрани их внутри игры. Если локальный сервер включён, он продолжит работать.")
                    .setPositiveButton("Закрыть экран", (dialog, which) -> finish())
                    .setNegativeButton("Вернуться в игру", (dialog, which) -> showCachedWeb()).show();
        }
        else super.onBackPressed();
    }
}
