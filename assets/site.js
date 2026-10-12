// Landing page: the demo race and the starting field of rivals.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = (v, digits) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Signed in (session stored by supabase-js): point the header to the personal page.
  try {
    if (Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))) {
      const nav = $('nav-account');
      nav.textContent = 'Mein Bereich';
      nav.href = '/du/';
    }
  } catch {
    // Storage blocked: keep "Anmelden".
  }

  // --- Demo race --------------------------------------------------------------
  // 3 km. The ghost runs an even 5:00/km (900 s). You start slower and finish
  // faster (5:10, 4:52, 4:48 per km), so the lead changes on the way.
  const RACE_M = 3000;
  const GHOST_S_PER_M = 0.3;
  const MY_SPLITS = [[0, 0], [310, 1000], [602, 2000], [890, 3000]];
  const END_S = 890;

  function myDistanceAt(t) {
    for (let i = 1; i < MY_SPLITS.length; i++) {
      const [t0, d0] = MY_SPLITS[i - 1];
      const [t1, d1] = MY_SPLITS[i];
      if (t <= t1) return d0 + ((t - t0) / (t1 - t0)) * (d1 - d0);
    }
    return RACE_M;
  }

  const route = $('race-route');
  if (route) {
    const length = route.getTotalLength();
    const done = $('race-done');
    done.setAttribute('d', route.getAttribute('d'));
    const place = (el, meters) => {
      const p = route.getPointAtLength((Math.min(meters, RACE_M) / RACE_M) * length);
      el.setAttribute('transform', `translate(${p.x} ${p.y})`);
    };

    function render(t) {
      const me = myDistanceAt(t);
      const ghost = Math.min(RACE_M, t / GHOST_S_PER_M);
      const gapS = me * GHOST_S_PER_M - t;
      const gapM = me - ghost;
      place($('race-me'), me);
      place($('race-ghost'), ghost);
      done.setAttribute('stroke-dasharray', `${(me / RACE_M) * length} ${length}`);

      const rounded = Math.round(gapS);
      const word = rounded > 0 ? 'vorne' : rounded < 0 ? 'hinten' : 'gleichauf';
      const gap = $('race-gap');
      gap.className = 'race-gap ' + (rounded > 0 ? 'ahead' : rounded < 0 ? 'behind' : '');
      gap.innerHTML = `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded)}<small> s</small>`;
      $('race-word').textContent = word;
      $('race-dist').textContent = fmt(me / 1000, 2);
      const meters = Math.round(gapM);
      $('race-meters').textContent = `${meters > 0 ? '+' : meters < 0 ? '−' : '±'}${Math.abs(meters)} m`;
      $('race-clock').textContent = clock(t);
    }

    const scrub = $('race-scrub');
    const playIcon = $('race-play-icon');
    let t = 0;
    let playing = false;
    let last = 0;
    let rest = 0;

    function setPlaying(on) {
      playing = on;
      $('race-live').classList.toggle('on', on);
      $('race-play').setAttribute('aria-label', on ? 'Anhalten' : 'Abspielen');
      playIcon.setAttribute('d', on ? 'M3 2h4v12H3zM9 2h4v12H9z' : 'M4 2l10 6-10 6z');
      if (on) {
        last = performance.now();
        requestAnimationFrame(step);
      }
    }

    function step(now) {
      if (!playing) return;
      const dt = (now - last) / 1000;
      last = now;
      if (t >= END_S) {
        // Hold the finish for a moment, then run again.
        rest += dt;
        if (rest > 2.5) {
          rest = 0;
          t = 0;
        }
      } else {
        t = Math.min(END_S, t + dt * 60);
      }
      scrub.value = String(Math.round((t / END_S) * 1000));
      render(t);
      requestAnimationFrame(step);
    }

    scrub.addEventListener('input', () => {
      setPlaying(false);
      t = (Number(scrub.value) / 1000) * END_S;
      render(t);
    });
    $('race-play').addEventListener('click', () => setPlaying(!playing));
    render(0);

    // Starts by itself once visible, unless reduced motion is requested.
    if (!reducedMotion && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setPlaying(true);
        }
      });
      io.observe(route.closest('figure'));
    }
  }

  // --- Starting field ---------------------------------------------------------
  const lineup = $('lineup');
  if (lineup) {
    fetch('/assets/rivals.json')
      .then((r) => r.json())
      .then(({ leagues, rivals }) => {
        const filter = $('field-filter');
        const byLeague = (id) => leagues.find((l) => l.id === id);
        const initials = (name) =>
          name.split(' ').filter((w) => !['Der', 'Die', 'Das'].includes(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const pace = (sPerKm) => `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, '0')} /km`;

        lineup.innerHTML = rivals
          .map((r, i) => {
            const l = byLeague(r.league);
            const pic = r.portrait
              ? `<img src="${r.portrait}" alt="" loading="lazy" width="256" height="256">`
              : `<span class="emblem">${initials(r.name)}</span>`;
            return `<article class="runner" tabindex="0" data-league="${r.league}" style="--league:${l.color}" aria-label="${r.name}, ${l.name}${r.boss ? ' Boss' : ''}">
              <div class="pic">${pic}<span class="no">${String(i + 1).padStart(2, '0')}</span>${r.boss ? '<span class="boss">BOSS</span>' : ''}</div>
              <div class="meta"><span class="label">${l.name} · ${r.archetype}</span><strong>${r.name}</strong><span class="pace">${pace(r.runPaceSPerKm)}</span></div>
              <div class="quote" aria-hidden="true"><span class="label">${r.title}</span><p>„${r.quote}“</p></div>
            </article>`;
          })
          .join('');

        const options = [{ id: 0, name: 'Alle', color: '' }, ...leagues];
        filter.innerHTML = options
          .map((l) => `<button type="button" data-league="${l.id}" aria-pressed="${l.id === 0}" style="${l.color ? `--league:${l.color}` : ''}">${l.name}</button>`)
          .join('');
        filter.addEventListener('click', (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;
          const id = Number(btn.dataset.league);
          filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
          lineup.querySelectorAll('.runner').forEach((el) => {
            el.hidden = id !== 0 && Number(el.dataset.league) !== id;
          });
        });
      })
      .catch(() => {
        lineup.innerHTML = '<p class="muted">Das Startfeld konnte nicht geladen werden.</p>';
      });
  }
})();
