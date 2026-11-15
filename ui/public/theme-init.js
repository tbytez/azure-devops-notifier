(function () {
  try {
    var KEY = 'azdoNotifier.theme.v1';
    var stored = null;
    try { stored = window.localStorage.getItem(KEY); } catch (e) {}
    var theme = stored === 'dark' || stored === 'light' ? stored : null;
    if (!theme) {
      try {
        theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch (e) {
        theme = 'light';
      }
    }
    var root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch (e) {}
})();
