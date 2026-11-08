// Bounded render-event profiler for repeatable Richardson camera checks.
'use strict';
(() => {
  if (new URLSearchParams(location.search).get('profile') !== '1') return;
  const out = document.createElement('pre');
  out.id = 'profile-output';
  out.style.cssText = 'position:absolute;z-index:20;left:12px;bottom:12px;max-width:560px;max-height:45vh;overflow:auto;padding:10px;background:#001b22e8;color:#d9ffff;font:11px/1.4 monospace;white-space:pre-wrap';
  out.textContent = 'profile: waiting for map';
  document.body.appendChild(out);

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (test, timeout = 10000) => {
    const end = performance.now() + timeout;
    while (performance.now() < end) { if (test()) return true; await delay(50); }
    return false;
  };
  const setHazard = async (id, on) => {
    const button = document.querySelector(`[data-h="${id}"]`);
    if (!button || (button.getAttribute('aria-pressed') === 'true') === on) return;
    button.click();
    await waitFor(() => window.__map?.isStyleLoaded(), 8000);
    await delay(250);
  };
  const setRadar = async on => {
    const input = document.getElementById('radar');
    if (!input || input.checked === on) return;
    input.checked = on;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(600);
  };
  const setLight = async mode => {
    document.querySelector(`[data-m="${mode}"]`)?.click();
    await waitFor(() => window.__map?.isStyleLoaded(), 5000);
    await delay(150);
  };
  const measure = async name => {
    const map = window.__map, times = [];
    const render = () => times.push(performance.now());
    map.jumpTo({ center: [-96.806, 32.946], zoom: 11.6, pitch: 38, bearing: -12 });
    await delay(200);
    map.on('render', render);
    const started = performance.now();
    map.easeTo({ center: [-96.701, 33.016], zoom: 13.2, pitch: 48, bearing: 8, duration: 1800, easing: t => t });
    await waitFor(() => !map.isMoving(), 5000);
    const ended = performance.now();
    map.off('render', render);
    const gaps = times.slice(1).map((time, i) => time - times[i]).sort((a, b) => a - b);
    const percentile = p => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] : 0;
    return { name, durationMs: Math.round(ended - started), frames: times.length, fps: Number((times.length / ((ended - started) / 1000)).toFixed(1)), medianGapMs: Number(percentile(.5).toFixed(1)), p95GapMs: Number(percentile(.95).toFixed(1)) };
  };

  (async () => {
    const ready = await waitFor(() => window.__map?.isStyleLoaded() && !window.__map?.isMoving() && document.querySelector('[data-h="tornado"]'), 12000);
    if (!ready) { out.textContent = 'profile: map readiness timeout (12s)'; return; }
    await delay(500);
    for (const mode of ['day', 'night', 'auto', 'day', 'night', 'auto']) await setLight(mode);
    const results = [];
    for (const id of ['flood', 'storm', 'hurricane', 'tornado']) await setHazard(id, false);
    await setRadar(false);
    results.push(await measure('basemap'));
    await setHazard('tornado', true);
    results.push(await measure('warnings-radar-off'));
    await setRadar(true);
    results.push(await measure('radar-on'));
    await setRadar(false);
    const report = { metrics: results, diagnostics: { client: window.DIALEVAC?.listenerCounts?.(), demo: window.__dialevacDemoDebug?.(), frameLoops: window.__dialevacState?.frameLoopCount } };
    window.__profileResults = report;
    out.textContent = JSON.stringify(report, null, 2);
  })().catch(error => { out.textContent = `profile failed: ${error?.stack || error}`; });
})();
