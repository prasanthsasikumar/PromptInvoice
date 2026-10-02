/* Optional Google Analytics 4. Off unless PI_CONFIG.gaMeasurementId is set in js/config.js.
   Records page views (with GA's own country/city) and a few product events (document type, currency).
   Never sends names, amounts, descriptions or any other document content. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PIAnalytics = factory().create(root, root.PI_CONFIG || {});
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(w, config) {
    const id = (config && config.gaMeasurementId) || '';
    if (!/^G-[A-Z0-9]{4,16}$/.test(id)) return { enabled: false, event: function () {} };
    w.dataLayer = w.dataLayer || [];
    w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', id, { anonymize_ip: true });
    const s = w.document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    w.document.head.appendChild(s);
    return { enabled: true, event: function (name, params) { w.gtag('event', name, params || {}); } };
  }
  return { create: create };
});
