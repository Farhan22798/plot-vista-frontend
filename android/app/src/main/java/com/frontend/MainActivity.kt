package com.frontend

import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // NOTE: setTheme() must be called AFTER super.onCreate().
    // Before super.onCreate(), the window is drawn with SplashTheme's windowBackground (the splash).
    // super.onCreate() sets a transparent ReactRootView — the splash still shows through it.
    // React Native renders its content → covers the splash naturally.
    // Only THEN do we switch to AppTheme to clean up theme state for the rest of the session.
    super.onCreate(savedInstanceState)
    setTheme(R.style.AppTheme)
    // Android 15+ (API 35): IME insets + edge-to-edge behaviour break adjustResize / KeyboardAvoidingView
    // for many RN apps. Apply bottom padding from IME + system bars on the window content root.
    // https://github.com/facebook/react-native/issues/49759
    if (Build.VERSION.SDK_INT >= 35) {
      setupKeyboardImeInsets()
    }
  }

  private fun setupKeyboardImeInsets() {
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      // Bottom: keyboard height when open + navigation bar; keeps focused inputs above keyboard.
      v.setPadding(0, 0, 0, ime.bottom + sys.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(root)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "frontend"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
