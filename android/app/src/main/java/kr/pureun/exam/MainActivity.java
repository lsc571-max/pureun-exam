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
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
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
        restoreDndIfLeftOn();

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 답안 백업·로그인 유지
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
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
        web.setWebChromeClient(new WebChromeClient());
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
                examOn = true;
                reportedUnpinned = false;
                lockAskedAt = System.currentTimeMillis();
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                dndOn();
                try { startLockTask(); } catch (Exception ignored) { }
                ui.removeCallbacks(watchPin);
                ui.postDelayed(watchPin, 1000);
            });
        }

        /** 시험 끝: 화면 고정 풀기 + 방해 금지 원래대로 */
        @JavascriptInterface
        public void stopLock() {
            ui.post(() -> {
                examOn = false;
                ui.removeCallbacks(watchPin);
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                try { stopLockTask(); } catch (Exception ignored) { }
                dndRestore();
            });
        }

        @JavascriptInterface
        public boolean isPinned() {
            return pinned();
        }

        @JavascriptInterface
        public int version() {
            return 1;
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
            // 고정을 요청한 직후에는 학생이 확인 창을 누를 시간(8초)을 줍니다.
            if (!p && !reportedUnpinned && System.currentTimeMillis() - lockAskedAt > 8000) {
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
