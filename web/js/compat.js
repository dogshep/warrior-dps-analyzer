// A plain script (not a module) so that even a browser too old for the page's modules can show this message.
(function () {
  var ok = typeof WebAssembly === 'object' && typeof Worker === 'function' && 'noModule' in HTMLScriptElement.prototype && !!Object.fromEntries;
  if (!ok) document.getElementById('oldBrowser').hidden = false;
})();
