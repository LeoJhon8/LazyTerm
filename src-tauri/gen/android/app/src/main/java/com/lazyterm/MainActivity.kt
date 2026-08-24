package com.lazyterm

import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override val handleBackNavigation = false

  private var appWebView: WebView? = null
  private var webViewBaseBottomMargin = 0
  private var backDispatchInFlight = false
  private var lastRootBackAt = 0L

  private val backPressedCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      handleAndroidBack()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, backPressedCallback)
    hideStatusBar()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    webViewBaseBottomMargin =
      (webView.layoutParams as? ViewGroup.MarginLayoutParams)?.bottomMargin ?: 0

    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      applyImeInset(view, insets)
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(
      webView,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onProgress(
          insets: WindowInsetsCompat,
          runningAnimations: MutableList<WindowInsetsAnimationCompat>,
        ): WindowInsetsCompat {
          applyImeInset(webView, insets)
          return insets
        }
      },
    )
    ViewCompat.requestApplyInsets(webView)
  }

  override fun onResume() {
    super.onResume()
    lastRootBackAt = 0L
    hideStatusBar()
  }

  override fun onDestroy() {
    appWebView?.let { webView ->
      ViewCompat.setOnApplyWindowInsetsListener(webView, null)
      ViewCompat.setWindowInsetsAnimationCallback(webView, null)
    }
    appWebView = null
    super.onDestroy()
  }

  private fun applyImeInset(view: View, insets: WindowInsetsCompat) {
    val imeBottom = if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
      insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    } else {
      0
    }
    val layoutParams = view.layoutParams as? ViewGroup.MarginLayoutParams ?: return
    val targetBottomMargin = webViewBaseBottomMargin + imeBottom
    if (layoutParams.bottomMargin == targetBottomMargin) return

    layoutParams.bottomMargin = targetBottomMargin
    view.layoutParams = layoutParams
  }

  private fun handleAndroidBack() {
    if (backDispatchInFlight || hideKeyboardIfVisible()) return

    val webView = appWebView
    if (webView == null) {
      handleRootBack()
      return
    }

    backDispatchInFlight = true
    try {
      webView.evaluateJavascript(
        "(() => window.__lazyTermHandleAndroidBack?.() ?? 'root')()"
      ) { result ->
        backDispatchInFlight = false
        if (result == "\"consumed\"") {
          lastRootBackAt = 0L
        } else {
          handleRootBack()
        }
      }
    } catch (_: RuntimeException) {
      backDispatchInFlight = false
      handleRootBack()
    }
  }

  private fun hideKeyboardIfVisible(): Boolean {
    val insets = ViewCompat.getRootWindowInsets(window.decorView) ?: return false
    if (!insets.isVisible(WindowInsetsCompat.Type.ime())) return false
    WindowCompat.getInsetsController(window, window.decorView)
      .hide(WindowInsetsCompat.Type.ime())
    lastRootBackAt = 0L
    return true
  }

  private fun handleRootBack() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastRootBackAt <= ROOT_BACK_TIMEOUT_MS) {
      lastRootBackAt = 0L
      if (!moveTaskToBack(true)) finish()
      return
    }

    lastRootBackAt = now
    Toast.makeText(this, R.string.back_again_to_desktop, Toast.LENGTH_SHORT).show()
  }

  private fun hideStatusBar() {
    WindowCompat.getInsetsController(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.statusBars())
    }
  }

  companion object {
    private const val ROOT_BACK_TIMEOUT_MS = 2_000L
  }
}
