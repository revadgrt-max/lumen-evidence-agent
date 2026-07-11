/* Lumen Evidence Agent — Capacitor native bridge
 * ------------------------------------------------
 * Dependency-free, plain <script src="native.js"></script>. No import/export,
 * no bundler. Uses the Capacitor runtime plugin proxy: installed native plugins
 * are callable as window.Capacitor.Plugins.<Name>.<method>(...) WITHOUT importing
 * any JS wrapper. In a plain browser this whole file is a harmless no-op because
 * every action is guarded behind window.Capacitor?.isNativePlatform?.().
 *
 * Owned file: only this file. Does not touch index.html, package.json, or
 * capacitor.config.json.
 */
(function () {
  'use strict';

  // --- Environment guard -----------------------------------------------------
  // Bail out entirely (silently) unless we're on a real native platform.
  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  if (!isNative) return; // plain browser: pure no-op, nothing wired up.

  // Convenience handles. Everything below optional-chains through these so a
  // missing plugin (not installed / not on this platform) can never throw.
  var Plugins = (Cap && Cap.Plugins) || {};
  var platform = (Cap && typeof Cap.getPlatform === 'function') ? Cap.getPlatform() : '';

  // Mark the document so CSS can react (mobile CSS keys safe-area padding off
  // the `native` class on <html>). Cheap and safe on any platform.
  try {
    if (document && document.documentElement) {
      document.documentElement.classList.add('native');
    }
  } catch (e) { /* ignore */ }

  // --- Splash + status bar ---------------------------------------------------
  // Runs once the DOM is ready: hides the splash and styles the status bar to
  // sit on the dark app background (#08080a) with light text.
  function initChrome() {
    // 1. Hide the native splash screen now that the web view has content.
    try {
      if (Plugins.SplashScreen && Plugins.SplashScreen.hide) {
        Plugins.SplashScreen.hide();
      }
    } catch (e) { /* ignore */ }

    // 2. Status bar: light text (DARK style => light content) on the dark bg.
    try {
      if (Plugins.StatusBar && Plugins.StatusBar.setStyle) {
        Plugins.StatusBar.setStyle({ style: 'DARK' });
      }
    } catch (e) { /* ignore */ }

    // 3. Android-only tint + non-overlay layout. iOS ignores these gracefully;
    //    each call is independently guarded so one missing method can't stop
    //    the others.
    try {
      if (Plugins.StatusBar && Plugins.StatusBar.setBackgroundColor) {
        Plugins.StatusBar.setBackgroundColor({ color: '#08080a' });
      }
    } catch (e) { /* ignore */ }
    try {
      if (Plugins.StatusBar && Plugins.StatusBar.setOverlaysWebView) {
        Plugins.StatusBar.setOverlaysWebView({ overlay: false });
      }
    } catch (e) { /* ignore */ }
  }

  // --- Haptics (delegated) ---------------------------------------------------
  // One document-level click listener gives every current and future .btn / .chip
  // a light haptic tap without per-element wiring.
  function initHaptics() {
    try {
      document.addEventListener('click', function (ev) {
        try {
          var t = ev.target;
          if (!t || typeof t.closest !== 'function') return;
          if (!t.closest('.btn') && !t.closest('.chip')) return;
          if (Plugins.Haptics && Plugins.Haptics.impact) {
            Plugins.Haptics.impact({ style: 'LIGHT' });
          }
        } catch (e) { /* ignore per-event */ }
      }, true); // capture phase: fires even if a handler stops propagation.
    } catch (e) { /* ignore */ }
  }

  // --- Android hardware back button -----------------------------------------
  // If the evidence stage is showing, treat Back as "return to hero" instead of
  // exiting the app. Only when we're already on the hero does Back exit.
  function initBackButton() {
    try {
      if (!(Plugins.App && Plugins.App.addListener)) return;
      Plugins.App.addListener('backButton', function () {
        try {
          var stage = document.getElementById('stage');
          var stageOn = !!(stage && stage.classList && stage.classList.contains('on'));
          if (stageOn) {
            // Return to the hero view rather than exiting.
            try { stage.classList.remove('on'); } catch (e) {}
            try {
              var hero = document.getElementById('hero');
              if (hero) hero.style.display = '';
            } catch (e) {}
            try {
              var punch = document.getElementById('punch');
              if (punch && punch.classList) punch.classList.remove('on');
            } catch (e) {}
            try { window.scrollTo(0, 0); } catch (e) {}
            return;
          }
          // Already on the hero: exit the app.
          if (Plugins.App && Plugins.App.exitApp) {
            Plugins.App.exitApp();
          }
        } catch (e) {
          // Last-ditch: try to exit rather than trap the user.
          try {
            if (Plugins.App && Plugins.App.exitApp) Plugins.App.exitApp();
          } catch (e2) { /* ignore */ }
        }
      });
    } catch (e) { /* ignore */ }
  }

  // --- Boot ------------------------------------------------------------------
  // Wire chrome on DOMContentLoaded, or immediately if the DOM is already ready.
  function boot() {
    initChrome();
    initHaptics();
    initBackButton();
  }
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot(); // DOM already parsed (script loaded late) — run now.
    }
  } catch (e) {
    // If anything about readiness detection fails, still attempt to boot.
    try { boot(); } catch (e2) { /* ignore */ }
  }
})();
