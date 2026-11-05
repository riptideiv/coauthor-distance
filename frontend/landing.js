/* Older shared graphs used the home page. Keep their fragments intact. */
(function () {
  if (new URLSearchParams(window.location.hash.slice(1)).has('map')) {
    window.location.replace('/connections' + window.location.hash);
  }
})();
