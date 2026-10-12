// Personal page (/du/): your numbers, recent activities, best times and
// rival standing, read with your session. RLS limits activities to you.
(function () {
  'use strict';

  const client = window.ghostrunClient;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (v, digits = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const SPORT = { run: 'Laufen', ride: 'Rad' };

  function duration(s) {
    s = Math.round(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function pace(sport, meters, seconds) {
    if (!meters || !seconds) return '–';
    if (sport === 'ride') return `${fmt((meters / seconds) * 3.6, 1)}<small>km/h</small>`;
    const s = seconds / (meters / 1000);
    return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}<small>/km</small>`;
  }
  const row = (main, sub, figures) =>
    `<div class="row"><div class="main"><strong>${main}</strong><span class="small muted">${sub}</span></div><div class="figures">${figures}</div></div>`;
  const empty = (text) => `<p class="empty-note">${text}</p>`;

  async function load(session) {
    const me = session.user.id;
    const [profile, activities, bests, fame] = await Promise.all([
      client.from('profiles').select('display_name, created_at').eq('id', me).maybeSingle(),
      client
        .from('activities')
        .select('sport, started_at, distance_m, moving_time_s')
        .order('started_at', { ascending: false })
        .limit(1000),
      client.from('route_leaderboard').select('route_id, elapsed_s, rank').eq('user_id', me),
      client.from('rival_fame').select('fame_total, fame_week, rivals_beaten, bosses_beaten').eq('user_id', me).maybeSingle(),
    ]);
    for (const res of [profile, activities, bests, fame]) if (res.error) throw res.error;

    const ids = bests.data.map((b) => b.route_id);
    const routes = ids.length ? await client.from('routes').select('id, name, sport, distance_m').in('id', ids) : { data: [], error: null };
    if (routes.error) throw routes.error;

    const name = (profile.data && profile.data.display_name) || '';
    const since = profile.data ? new Date(profile.data.created_at) : null;
    $('hello').textContent = name ? `Hallo, ${name.split(' ')[0]}` : 'Hallo';
    $('email').textContent = session.user.email || '';
    $('since').textContent = since ? `Dabei seit ${MONTHS[since.getMonth()]} ${since.getFullYear()}` : '';

    const list = activities.data;
    const meters = list.reduce((a, x) => a + x.distance_m, 0);
    const seconds = list.reduce((a, x) => a + x.moving_time_s, 0);
    const f = fame.data;
    $('s-distance').innerHTML = `${fmt(meters / 1000, 1)}<small>km</small>`;
    $('s-count').textContent = fmt(list.length);
    $('s-time').innerHTML = `${Math.floor(seconds / 3600)}<small>h</small> ${Math.round((seconds % 3600) / 60)}<small>min</small>`;
    $('s-rivals').textContent = f ? fmt(f.rivals_beaten) : '0';

    $('activities').innerHTML = list.length
      ? list
          .slice(0, 10)
          .map((a) => {
            const t = new Date(a.started_at);
            return row(
              `${SPORT[a.sport]} · ${t.getDate()}. ${MONTHS[t.getMonth()]}`,
              `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} Uhr`,
              `<span>${fmt(a.distance_m / 1000, 2)}<small>km</small></span><span>${duration(a.moving_time_s)}</span><span>${pace(a.sport, a.distance_m, a.moving_time_s)}</span>`,
            );
          })
          .join('')
      : empty('Noch keine Aktivitäten. Zeichne in der App deinen ersten Lauf auf.');

    const withRoute = bests.data
      .map((b) => ({ ...b, route: routes.data.find((r) => r.id === b.route_id) }))
      .filter((b) => b.route)
      .sort((a, b) => a.rank - b.rank);
    $('bests').innerHTML = withRoute.length
      ? withRoute
          .map((b) =>
            row(esc(b.route.name), `${SPORT[b.route.sport]} · ${fmt(b.route.distance_m / 1000, 2)} km`, `<span>${duration(b.elapsed_s)}</span><span>Platz ${b.rank}</span>`),
          )
          .join('')
      : empty('Noch keine Zeiten. Lauf in der App ein Rennen auf einer Strecke.');

    $('rivals').innerHTML = f
      ? [
          row('Ruhm gesamt', 'aus allen Siegen gegen Rivalen', `<span>${fmt(Math.round(f.fame_total))}</span>`),
          row('Ruhm diese Woche', 'seit Montag', `<span>${fmt(Math.round(f.fame_week))}</span>`),
          row('Bosse besiegt', 'von 5 Ligen', `<span>${fmt(f.bosses_beaten)}</span>`),
        ].join('')
      : empty('Noch keine Rivalen besiegt. Rivalen findest du in der App auf jeder Strecke.');

    $('loading').hidden = true;
    $('account').hidden = false;
  }

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
