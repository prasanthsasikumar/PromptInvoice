/* Optional, cookieless analytics: Google Analytics 4 and PostHog.
   GA4 is off unless PI_CONFIG.gaMeasurementId is set; PostHog is off unless PI_CONFIG.posthogKey is set (js/config.js).
   GA runs with Consent Mode defaults set to denied, so it sends cookieless pings; PostHog runs in cookieless mode
   with no person profiles. Neither writes cookies or browser storage for tracking.
   Records page views (with GA's own country/city) and a few product events (document type, currency).
   Never sends names, amounts, descriptions or any other document content. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PIAnalytics = factory().create(root, root.PI_CONFIG || {});
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // PostHog's standard HTML snippet (posthog.com/docs/libraries/js), bound to the given window.
  function loadPosthog(w, key) {
    !function(t,e){var o,n,p,r;e.__SV||(w.posthog&&w.posthog.__loaded)||(w.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(w.document,w.posthog||[]);
    w.posthog.init(key, {
      api_host: 'https://us.i.posthog.com',
      ui_host: 'https://us.posthog.com',
      defaults: '2025-05-24',
      cookieless_mode: 'always',
      person_profiles: 'never',
      capture_pageview: true,
    });
  }

  function create(w, config) {
    const id = (config && config.gaMeasurementId) || '';
    const phKey = (config && config.posthogKey) || '';
    let ga = false;
    if (/^G-[A-Z0-9]{4,16}$/.test(id)) {
      ga = true;
      w.dataLayer = w.dataLayer || [];
      w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      // Consent Mode defaults must be set before config so GA never sets cookies.
      w.gtag('consent', 'default', {
        analytics_storage: 'denied', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied',
      });
      w.gtag('js', new Date());
      w.gtag('config', id, { anonymize_ip: true });
      const s = w.document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
      w.document.head.appendChild(s);
    }
    if (/^phc_[A-Za-z0-9]{20,64}$/.test(phKey)) loadPosthog(w, phKey);
    if (!ga) return { enabled: false, event: function () {} };
    return { enabled: true, event: function (name, params) { w.gtag('event', name, params || {}); } };
  }
  return { create: create };
});
