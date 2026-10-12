// Personal page (/du/): your runs, best times and rivals, read live from
// Supabase with your session. RLS limits activities to their owner.
(function () {
  'use strict';

  const client = window.ghostrunClient;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (v, digits = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const km = (m, digits = 1) => fmt(m / 1000, digits);
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const SPORT = { run: 'Lauf', ride: 'Rad' };

  function duration(s) {
    s = Math.round(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function hours(s) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h ? `${h}<small>h</small> ${m}<small>min</small>` : `${m}<small>min</small>`;
  }
  function pace(sport, meters, seconds) {
    if (!meters || !seconds) return '–';
    if (sport === 'ride') return `${fmt((meters / seconds) * 3.6, 1)} km/h`;
    const s = seconds / (meters / 1000);
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km`;
  }
  /** Monday 00:00 of the week containing d. */
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  // Google encoded polyline (precision 5), as stored in activities.preview_polyline.
  function decodePolyline(str) {
    const pts = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      for (const which of [0, 1]) {
        let shift = 0, result = 0, b;
        do {
          b = str.charCodeAt(i++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const delta = result & 1 ? ~(result >> 1) : result >> 1;
        if (which === 0) lat += delta;
        else lng += delta;
      }
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }
  function shapeSvg(polyline) {
    if (!polyline) return '';
    const pts = decodePolyline(polyline);
    if (pts.length < 2) return '';
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    const k = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180));
    const w = (Math.max(...lngs) - Math.min(...lngs)) * k || 1e-6;
    const h = Math.max(...lats) - Math.min(...lats) || 1e-6;
    const scale = Math.min(48 / w, 36 / h);
    const ox = (52 - w * scale) / 2;
    const oy = (40 - h * scale) / 2;
    const d = pts
      .map(([la, ln], j) => `${j ? 'L' : 'M'}${(ox + (ln - Math.min(...lngs)) * k * scale).toFixed(1)},${(oy + (Math.max(...lats) - la) * scale).toFixed(1)}`)
      .join('');
    return `<svg viewBox="0 0 52 40" aria-hidden="true"><path d="${d}" fill="none" stroke="#F2F6F7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // --- Load ------------------------------------------------------------------

  async function load(session) {
    const me = session.user.id;
    const [profile, activities, pbs, wins, fame, roster] = await Promise.all([
      client.from('profiles').select('display_name, avatar_url, created_at').eq('id', me).maybeSingle(),
      client
        .from('activities')
        .select('id, sport, started_at, distance_m, moving_time_s, preview_polyline')
        .order('started_at', { ascending: false })
        .limit(1000),
      client.from('route_leaderboard').select('route_id, elapsed_s, rank').eq('user_id', me),
      client.from('rival_wins').select('rival_id, route_id').eq('user_id', me),
      client.from('rival_fame').select('user_id, display_name, avatar_url, fame_week, fame_total').order('fame_week', { ascending: false }).limit(10),
      fetch('/assets/rivals.json').then((r) => r.json()),
    ]);
    for (const res of [profile, activities, pbs, wins, fame]) if (res.error) throw res.error;

    const routeIds = pbs.data.map((r) => r.route_id);
    const routes = routeIds.length
      ? await client.from('routes').select('id, name, sport, distance_m').in('id', routeIds)
      : { data: [], error: null };
    if (routes.error) throw routes.error;
    const myFame = await client.from('rival_fame').select('fame_total').eq('user_id', me).maybeSingle();

    render({
      me,
      email: session.user.email,
      profile: profile.data,
      activities: activities.data,
      pbs: pbs.data.map((p) => ({ ...p, route: routes.data.find((r) => r.id === p.route_id) })).filter((p) => p.route),
      wins: wins.data,
      fame: fame.data.filter((f) => f.fame_week > 0),
      myFame: myFame.data ? myFame.data.fame_total : 0,
      roster,
    });
  }

  // --- Render ----------------------------------------------------------------

  function render(d) {
    const name = (d.profile && d.profile.display_name) || 'Ghostrunner';
    const since = d.profile ? new Date(d.profile.created_at) : new Date();
    const { leagues, rivals } = d.roster;

    // Start bib: a stable number from your account id.
    const bib = (parseInt(d.me.replace(/-/g, '').slice(0, 8), 16) % 9000) + 1000;
    $('bib-no').textContent = bib;
    $('bib-name').textContent = name;
    $('bib-season').textContent = `Saison ${new Date().getFullYear()}`;
    $('since').textContent = `Dabei seit ${MONTHS[since.getMonth()]} ${since.getFullYear()}`;
    $('hello').textContent = `Hallo, ${name.split(' ')[0]}`;

    // League: the lowest league whose boss you have not beaten (same rule as the app).
    const beaten = new Set(d.wins.map((w) => w.rival_id));
    let league = 1;
    while (league < 5 && beaten.has(rivals.find((r) => r.league === league && r.boss).id)) league++;
    const l = leagues.find((x) => x.id === league);
    const chip = $('league-chip');
    chip.style.setProperty('--league', l.color);
    chip.textContent = `${l.name}-Liga · ${beaten.size} von ${rivals.length} Rivalen besiegt`;
    $('bib-strip').style.background = l.color;

    // Totals.
    const total = d.activities.reduce((a, x) => ({ m: a.m + x.distance_m, s: a.s + x.moving_time_s }), { m: 0, s: 0 });
    $('t-distance').innerHTML = `${km(total.m)}<small>km</small>`;
    $('t-count').textContent = fmt(d.activities.length);
    $('t-time').innerHTML = hours(total.s);
    $('t-fame').textContent = fmt(Math.round(d.myFame));

    renderWeeks(d.activities);
    renderRuns(d.activities);
    renderPbs(d.pbs);
    renderRivals(d.roster, beaten);
    renderFame(d.fame, d.me);

    $('loading').hidden = true;
    $('dash').hidden = false;
  }

  function renderWeeks(activities) {
    const now = weekStart(new Date());
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const start = new Date(now);
      start.setDate(start.getDate() - (11 - i) * 7);
      return { start, m: 0 };
    });
    for (const a of activities) {
      const ws = weekStart(new Date(a.started_at)).getTime();
      const w = weeks.find((x) => x.start.getTime() === ws);
      if (w) w.m += a.distance_m;
    }
    const max = Math.max(...weeks.map((w) => w.m), 1000);
    const W = 600, H = 180, gap = 8, bw = (W - gap * 11) / 12, top = 22, base = H - 22;
    const bars = weeks
      .map((w, i) => {
        const h = Math.max(2, ((base - top) * w.m) / max);
        const x = i * (bw + gap);
        const label = `Woche ab ${w.start.getDate()}.${w.start.getMonth() + 1}.: ${km(w.m)} km`;
        return `<rect class="bar${i === 11 ? ' current' : ''}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" tabindex="0" data-tip="${km(w.m)} km" aria-label="${label}"/>
          <text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" fill="#8A979C" font-family="Barlow Condensed" font-size="13" text-anchor="middle">${w.start.getDate()}.${w.start.getMonth() + 1}.</text>`;
      })
      .join('');
    const box = $('weeks');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Kilometer pro Woche">${bars}</svg><div class="tip" hidden></div>`;
    const tip = box.querySelector('.tip');
    const show = (el) => {
      const r = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      tip.textContent = el.dataset.tip;
      tip.style.left = `${r.left - b.left + r.width / 2}px`;
      tip.style.top = `${Math.max(0, r.top - b.top - 30)}px`;
      tip.hidden = false;
    };
    box.querySelectorAll('.bar').forEach((el) => {
      el.addEventListener('mouseenter', () => show(el));
      el.addEventListener('focus', () => show(el));
      el.addEventListener('mouseleave', () => (tip.hidden = true));
      el.addEventListener('blur', () => (tip.hidden = true));
    });
  }

  function renderRuns(activities) {
    const box = $('runs');
    $('runs-count').textContent = activities.length ? `${activities.length} insgesamt` : '';
    if (!activities.length) {
      box.innerHTML = '<p class="empty">Noch keine Läufe. Zeichne in der App deinen ersten Lauf auf, dann erscheint er hier.</p>';
      return;
    }
    const rows = activities
      .slice(0, 15)
      .map((a) => {
        const t = new Date(a.started_at);
        return `<tr>
          <td class="shape">${shapeSvg(a.preview_polyline)}</td>
          <td class="when"><b>${DAYS[t.getDay()]}, ${t.getDate()}. ${MONTHS[t.getMonth()]}</b>${SPORT[a.sport]} · ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} Uhr</td>
          <td class="r">${km(a.distance_m, 2)} <span class="label">km</span></td>
          <td class="r hide-s">${duration(a.moving_time_s)}</td>
          <td class="r">${pace(a.sport, a.distance_m, a.moving_time_s)}</td>
        </tr>`;
      })
      .join('');
    box.innerHTML = `<table class="runs"><thead><tr><th></th><th>Wann</th><th class="r">Distanz</th><th class="r hide-s">Zeit</th><th class="r">Tempo</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderPbs(pbs) {
    const box = $('pbs');
    if (!pbs.length) {
      box.innerHTML = '<p class="empty">Noch keine Zeiten auf Strecken. Lauf in der App ein Rennen gegen einen Ghost oder Rivalen.</p>';
      return;
    }
    box.className = 'pbs';
    box.innerHTML = pbs
      .sort((a, b) => a.rank - b.rank)
      .map(
        (p) => `<div class="pb" style="border-left-color:${p.rank === 1 ? 'var(--gold)' : 'var(--ghost)'}">
          <div><span class="label">${SPORT[p.route.sport]} · ${km(p.route.distance_m, 2)} km</span><strong>${esc(p.route.name)}</strong></div>
          <div><div class="time">${duration(p.elapsed_s)}</div><div class="rank">Platz ${p.rank}</div></div>
        </div>`,
      )
      .join('');
  }

  function renderRivals({ leagues, rivals }, beaten) {
    $('rivals-count').textContent = `${beaten.size} / ${rivals.length}`;
    const initials = (n) => n.split(' ').filter((w) => !['Der', 'Die', 'Das'].includes(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    $('rival-grid').innerHTML = rivals
      .map((r) => {
        const won = beaten.has(r.id);
        const color = leagues.find((l) => l.id === r.league).color;
        const pic = r.portrait ? `<img src="${r.portrait}" alt="" loading="lazy">` : `<span class="emblem">${initials(r.name)}</span>`;
        return `<div class="slot${won ? '' : ' locked'}" style="--league:${color}" title="${won ? esc(r.name) : 'Noch nicht besiegt'}">${pic}${
          won ? '<span class="won" aria-label="besiegt"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#0A0D0F" stroke-width="1.8" fill="none"/></svg></span>' : ''
        }</div>`;
      })
      .join('');
  }

  function renderFame(rows, me) {
    const box = $('fame');
    if (!rows.length) {
      box.innerHTML = '<p class="empty">Diese Woche hat noch niemand einen Rivalen besiegt.</p>';
      return;
    }
    box.innerHTML = rows
      .map((r, i) => {
        const pic = r.avatar_url ? `<img src="${esc(r.avatar_url)}" alt="">` : `<span class="ini">${esc((r.display_name || '?')[0].toUpperCase())}</span>`;
        return `<div class="fame-row${r.user_id === me ? ' me' : ''}">
          <span class="pos${i === 0 ? ' p1' : ''}">${i + 1}</span>${pic}<span>${esc(r.display_name)}</span><span class="pts">${fmt(Math.round(r.fame_week))}</span>
        </div>`;
      })
      .join('');
  }

  // --- Session ---------------------------------------------------------------

  $('signout').addEventListener('click', async () => {
    await client.auth.signOut();
    location.replace('/');
  });

  client.auth.getSession().then(({ data }) => {
    if (!data.session) return location.replace('/login/');
    load(data.session).catch(() => {
      $('loading').hidden = true;
      $('load-error').textContent = 'Deine Daten konnten nicht geladen werden. Prüf deine Verbindung und lade die Seite neu.';
    });
  });
})();
