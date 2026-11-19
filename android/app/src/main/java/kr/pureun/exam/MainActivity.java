package kr.pureun.exam;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 푸른시험 — 시험 웹(https://pureun-exam.web.app)을 감싼 앱.
 * 웹이 할 수 없는 네 가지를 맡습니다: 화면 고정, 캡처·녹화 차단, 방해 금지 자동 켜기/되돌리기, 이탈 알림.
 * 웹에서는 window.PureunApp 으로 부르고, 앱은 window.onPureunEvent(이름) 으로 알려 줍니다.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://pureun-exam.web.app/";
    private static final String PREFS = "pureun", KEY_PREV_DND = "prevDnd";

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean examOn = false;   // 시험 중 (웹이 startLock 을 부른 뒤 stopLock 까지)
    private boolean reportedUnpinned = false;
    private long lockAskedAt = 0;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        // 캡처·녹화 차단: 최근 앱 화면에서도 내용이 보이지 않습니다.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        // 다른 앱이 화면 위에 띄우는 창(떠 있는 메모·채팅 등)을 숨깁니다 (안드로이드 12 이상)
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            try { getWindow().setHideOverlayWindows(true); } catch (Exception ignored) { }
        }
        restoreDndIfLeftOn();

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 답안 백업·로그인 유지
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // 얼굴 확인용 카메라 화면을 누르지 않아도 틀 수 있게
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);                    // 기기 글자 크기 설정과 무관하게 한 화면에 맞춤
        s.setUserAgentString(s.getUserAgentString() + " PureunExamApp/1");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true); // 길게 눌러 복사 메뉴 막기
        web.setHapticFeedbackEnabled(false);
        web.addJavascriptInterface(new Bridge(), "PureunApp");
        web.setWebChromeClient(new WebChromeClient() {
            // 시험 사이트가 카메라를 요청하면(얼굴 확인) 안드로이드 권한을 받은 뒤 허락합니다.
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                ui.post(() -> handleCameraRequest(request));
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // 시험 사이트 밖으로는 나가지 않습니다. (문항 속 영상은 화면 안에서 재생됩니다)
                String host = r.getUrl().getHost();
                return !(host != null && (host.equals("pureun-exam.web.app") || host.equals("pureun-exam.firebaseapp.com")));
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showOffline();
            }
        });
        if (saved != null) web.restoreState(saved); else web.loadUrl(HOME);
    }

    private PermissionRequest pendingCamera;

    private void handleCameraRequest(PermissionRequest request) {
        String host = request.getOrigin() == null ? null : request.getOrigin().getHost();
        boolean ours = host != null && (host.equals("pureun-exam.web.app") || host.equals("pureun-exam.firebaseapp.com"));
        boolean video = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
        if (!ours || !video) { request.deny(); return; }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            if (pendingCamera != null) pendingCamera.deny();
            pendingCamera = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != 1 || pendingCamera == null) return;
        PermissionRequest r = pendingCamera; pendingCamera = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else r.deny();
    }

    private void showOffline() {
        String html = "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<body style='font-family:sans-serif;background:#f4f8f6;color:#17231d;display:flex;flex-direction:column;"
                + "justify-content:center;align-items:center;height:100vh;margin:0;padding:24px;text-align:center'>"
                + "<h2>인터넷에 연결되지 않았어요</h2><p>와이파이나 데이터를 확인한 뒤 다시 시도해 주세요.</p>"
                + "<a href='" + HOME + "' style='margin-top:16px;background:#2f8f66;color:#fff;padding:14px 28px;"
                + "border-radius:14px;text-decoration:none;font-weight:bold'>다시 시도</a></body>";
        web.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
    }

    /* ---------- 웹에서 부르는 기능 ---------- */
    private class Bridge {
        /** 방해 금지가 지금 켜져 있는가 */
        @JavascriptInterface
        public boolean isDndOn() {
            int f = nm().getCurrentInterruptionFilter();
            return f != NotificationManager.INTERRUPTION_FILTER_ALL && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
        }

        /** 앱이 방해 금지를 자동으로 켜고 끌 수 있는가 (학생이 한 번 허용해야 함) */
        @JavascriptInterface
        public boolean canAutoDnd() {
            return nm().isNotificationPolicyAccessGranted();
        }

        /** 방해 금지 자동 켜기를 허용하는 설정 화면을 엽니다 */
        @JavascriptInterface
        public void requestDndAccess() {
            ui.post(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                } catch (Exception e) {
                    try { startActivity(new Intent("android.settings.ZEN_MODE_SETTINGS")); } catch (Exception ignored) { }
                }
            });
        }

        /** 시험 시작: 방해 금지 켜기 + 화면 고정 */
        @JavascriptInterface
        public void startLock() {
            ui.post(() -> {
                // 이미 시험 중이면(고정이 풀려 다시 고정하는 경우) "풀림" 표시는 그대로 둡니다.
                // 그래야 다시 고정됐을 때 웹에 알려 가림 화면을 걷을 수 있습니다.
                if (!examOn) reportedUnpinned = false;
                examOn = true;
                lockAskedAt = System.currentTimeMillis();
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                immersive(true);
                dndOn();
                try { startLockTask(); } catch (Exception ignored) { }
                ui.removeCallbacks(watchPin);
                ui.postDelayed(watchPin, 1000);
            });
        }

        /** 시험 안내 화면부터 전체 화면(위아래 줄 숨김). 시험 중에는 끄지 않습니다. */
        @JavascriptInterface
        public void fullscreen(boolean on) {
            ui.post(() -> { if (on || !examOn) immersive(on); });
        }

        /** 시험 끝: 화면 고정 풀기 + 방해 금지 원래대로 */
        @JavascriptInterface
        public void stopLock() {
            ui.post(() -> {
                examOn = false;
                reportedUnpinned = false;
                ui.removeCallbacks(watchPin);
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                immersive(false);
                try { stopLockTask(); } catch (Exception ignored) { }
                dndRestore();
            });
        }

        @JavascriptInterface
        public boolean isPinned() {
            return pinned();
        }

        /** 기기 발열 단계: 0 없음 · 1 약함 · 2 보통 · 3 심함(경고) 이상. 3 이상이면 웹이 카메라를 끕니다. */
        @JavascriptInterface
        public int thermalStatus() {
            if (android.os.Build.VERSION.SDK_INT < 29) return 0;
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                return pm == null ? 0 : pm.getCurrentThermalStatus();
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public int version() {
            return 2;
        }
    }

    /* ---------- 화면 고정 감시 ---------- */
    private boolean pinned() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    // 시험 중 1초마다 확인합니다. 고정이 풀려 있으면 웹에 알려 기록하고 문제를 가리게 합니다.
    private final Runnable watchPin = new Runnable() {
        @Override
        public void run() {
            if (!examOn) return;
            boolean p = pinned();
            // 고정을 요청한 직후에는 학생이 확인 창을 읽고 누를 시간(25초)을 줍니다.
            if (!p && !reportedUnpinned && System.currentTimeMillis() - lockAskedAt > 25000) {
                reportedUnpinned = true;
                tell("unpin");
            } else if (p && reportedUnpinned) {
                reportedUnpinned = false;
                tell("pinned");
            }
            ui.postDelayed(this, 1000);
        }
    };

    private void tell(String event) {
        if (web != null) web.evaluateJavascript("window.onPureunEvent&&window.onPureunEvent('" + event + "')", null);
    }

    /* ---------- 방해 금지 ---------- */
    private NotificationManager nm() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void dndOn() {
        NotificationManager n = nm();
        if (!n.isNotificationPolicyAccessGranted()) return;
        try {
            if (!prefs().contains(KEY_PREV_DND)) prefs().edit().putInt(KEY_PREV_DND, n.getCurrentInterruptionFilter()).apply();
            n.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        } catch (Exception ignored) { }
    }

    private void dndRestore() {
        if (!prefs().contains(KEY_PREV_DND)) return;
        int prev = prefs().getInt(KEY_PREV_DND, NotificationManager.INTERRUPTION_FILTER_ALL);
        prefs().edit().remove(KEY_PREV_DND).apply();
        NotificationManager n = nm();
        if (!n.isNotificationPolicyAccessGranted()) return;
        if (prev == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) prev = NotificationManager.INTERRUPTION_FILTER_ALL;
        try { n.setInterruptionFilter(prev); } catch (Exception ignored) { }
    }

    // 시험 중에 앱이 꺼졌다면 방해 금지가 켜진 채 남아 있을 수 있으므로, 다음에 켤 때 되돌립니다.
    private void restoreDndIfLeftOn() {
        try { dndRestore(); } catch (Exception ignored) { }
    }

    /* ---------- 앱을 벗어남 / 돌아옴 ---------- */
    @Override
    protected void onPause() {
        super.onPause();
        if (examOn) tell("leave");
    }

    /** 시험 중에는 위(시계·알림)와 아래(버튼) 줄을 숨겨 전체 화면으로 봅니다. 가장자리를 밀면 잠깐 보였다가 다시 숨습니다.
     *  (키보드가 뜰 때 입력 칸이 가려지지 않도록, 화면 배치는 그대로 두고 줄만 숨깁니다) */
    @SuppressWarnings("deprecation")
    private void immersive(boolean on) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c == null) return;
                if (on) {
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            } else {
                getWindow().getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                    : View.SYSTEM_UI_FLAG_VISIBLE);
            }
        } catch (Exception ignored) { }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && examOn) immersive(true);   // 다른 창이 떴다 사라져도 다시 전체 화면으로
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (examOn) {
            tell("back");
            if (!pinned()) {   // 돌아왔는데 고정이 풀려 있으면 다시 고정을 요청
                lockAskedAt = System.currentTimeMillis();
                try { startLockTask(); } catch (Exception ignored) { }
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (examOn) return;                       // 시험 중에는 뒤로 가기를 막습니다
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacks(watchPin);
        if (examOn) { examOn = false; dndRestore(); }
        if (web != null) { web.removeJavascriptInterface("PureunApp"); web.destroy(); web = null; }
        super.onDestroy();
    }
}
