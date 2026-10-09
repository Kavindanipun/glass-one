/* PRIVACY cinematic scroll renderer. 40 original frames preload, only one
   decoded frame is drawn at a time. The underlying poster never disappears. */
(() => {
  'use strict';
  const story = document.querySelector('.privacy-story');
  const canvas = document.getElementById('privacy-animation');
  const poster = document.getElementById('privacy-poster');
  if (!story || !canvas || !poster) return;
  const context = canvas.getContext('2d', { alpha:false });
  if (!context) return; // visible poster is still the fallback
  const TOTAL = 40;
  const resources = Array(TOTAL).fill(null);
  const errors = Array(TOTAL).fill(false);
  const loaded = Array(TOTAL).fill(false);
  const progressBar = document.getElementById('privacy-progress');
  const progressRail = document.getElementById('privacy-progress-rail');
  const count = document.getElementById('privacy-count');
  const details = [...story.querySelectorAll('.privacy-detail')];
  const loader = document.getElementById('privacy-frame-loader');
  const loaderCount = document.getElementById('privacy-frame-loader-count');
  let completed = 0;
  let wanted = 0;
  let shown = -1;
  let drawing = false;
  let raf = 0;
  let lastBitmap = null;
  const frameUrl = i => 'privacy-frames/' + String(i).padStart(3, '0') + '.jpg';
  const clamp = x => Math.max(0, Math.min(1, x));

  function ratio() {
    const r = story.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - window.innerHeight));
  }
  function sync(p) {
    if (progressBar) progressBar.style.width = (p * 100).toFixed(2) + '%';
    progressRail?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (count) count.textContent = p < .30 ? '01' : p < .61 ? '02' : p < .78 ? '03' : '04';
    const phase = p < .30 ? 0 : p < .61 ? 1 : p < .78 ? 2 : 3;
    details.forEach(el => {
      const on = Number(el.dataset.privacyPhase) === phase;
      el.classList.toggle('is-visible', on);
      el.setAttribute('aria-hidden', String(!on));
    });
  }
  function updatedLoader() {
    if (loaderCount) loaderCount.textContent = completed + ' / ' + TOTAL;
    if (completed >= TOTAL) {
      loader?.classList.remove('is-loading');
      loader?.classList.add('is-complete');
      loader?.setAttribute('aria-busy', 'false');
    }
  }
  function attemptRender() {
    if (drawing || wanted === shown || !loaded[wanted]) return;
    const target = wanted;
    const res = resources[target];
    if (!res) return;
    drawing = true;
    // One decoded bitmap at a time means ~8MB active frame memory instead of
    // keeping all sixty 1080p images decoded (~480MB) in a mobile browser.
    const paint = image => {
      if (target !== wanted) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      shown = target;
      canvas.classList.add('has-frame');
    };
    const done = () => {
      drawing = false;
      if (wanted !== shown && loaded[wanted]) requestAnimationFrame(attemptRender);
    };
    if (res instanceof Blob && typeof createImageBitmap === 'function') {
      createImageBitmap(res).then(bmp => {
        paint(bmp);
        bmp.close?.();
      }).catch(() => loadSingleImage(target).then(paint).catch(() => {})).finally(done);
    } else if (res instanceof Blob) {
      loadSingleImage(target).then(paint).catch(() => {}).finally(done);
    } else {
      // Local file previews cannot use fetch in some browsers; decoded Image
      // elements provide a working fallback without blanking the stage.
      (res.decode ? res.decode().catch(() => {}) : Promise.resolve()).then(() => {
        if (res.naturalWidth) paint(res);
      }).finally(done);
    }
  }
  function loadSingleImage(index) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = frameUrl(index);
    });
  }
  function render() {
    raf = 0;
    const p = ratio();
    sync(p);
    wanted = Math.round(p * (TOTAL - 1));
    attemptRender();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(render); }
  window.addEventListener('scroll', schedule, { passive:true });
  window.addEventListener('resize', schedule, { passive:true });
  window.addEventListener('pageshow', schedule);
  // The visible poster needs no JS or loader in order to appear.
  if (poster.complete && poster.naturalWidth) {
    loaded[0] = true;
  }

  async function preloadHTTP() {
    let cursor = 0;
    async function worker() {
      while (cursor < TOTAL) {
        const idx = cursor++;
        try {
          const response = await fetch(frameUrl(idx), { cache:'force-cache' });
          if (!response.ok) throw new Error(String(response.status));
          resources[idx] = await response.blob();
          loaded[idx] = true;
          if (idx === wanted) attemptRender();
        } catch (_) { errors[idx] = true; }
        completed++; updatedLoader();
      }
    }
    await Promise.all(Array.from({length:6}, worker));
  }
  async function preloadLocal() {
    let cursor = 0;
    async function worker() {
      while (cursor < TOTAL) {
        const idx = cursor++;
        try {
          resources[idx] = await loadSingleImage(idx);
          loaded[idx] = true;
          if (idx === wanted) attemptRender();
        } catch (_) { errors[idx] = true; }
        completed++; updatedLoader();
      }
    }
    await Promise.all(Array.from({length:6}, worker));
  }
  let started = false;
  function beginPreload() {
    if (started) return;
    started = true;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      preloadHTTP().then(() => {
        const bad = errors.map((x,i)=>x?i:-1).filter(x=>x>=0);
        bad.forEach(i=>loadSingleImage(i).then(img=>{
          resources[i]=img;loaded[i]=true;errors[i]=false;
          if(i===wanted)attemptRender();
        }).catch(()=>{}));
      });
    } else { preloadLocal(); }
  }
  // Prefetch when the second section is approaching. Keep the first frame
  // visible even before all frames have downloaded or decoded.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e=>e.isIntersecting)) { beginPreload(); observer.disconnect(); }
    }, {rootMargin:'150% 0px'});
    observer.observe(story);
  } else { beginPreload(); }
  render();
})();