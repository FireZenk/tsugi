// Dev harness only (not part of the extension). Simulates the chrome.* APIs the
// content scripts use and the Crunchyroll API with synthetic data shaped like the
// real responses, so the UI can be iterated on without loading the extension.
(() => {
  const params = new URLSearchParams(location.search);
  const LOGGED_OUT = params.has('anon');
  const DAY = 86400000;
  const NOW = Date.now();

  // ---- chrome.storage / chrome.runtime shim (backed by localStorage) ----
  const listeners = [];
  const area = (name) => {
    const key = 'crp-dev:' + name;
    const read = () => JSON.parse(localStorage.getItem(key) || '{}');
    return {
      async get(k) {
        // ?stall: settings never arrive (tests the start-up watchdog)
        if (params.has('stall') && name === 'sync') return new Promise(() => {});
        const all = read(); if (k == null) return all; const o = {}; [].concat(k).forEach((x) => { if (x in all) o[x] = all[x]; }); return o; },
      async set(o) { const all = { ...read(), ...o }; localStorage.setItem(key, JSON.stringify(all)); setTimeout(() => listeners.forEach((fn) => fn(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), name))); },
      async remove(ks) { const all = read(); [].concat(ks).forEach((k) => delete all[k]); localStorage.setItem(key, JSON.stringify(all)); },
    };
  };
  window.chrome = {
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: {
      getURL: (p) => '../' + p + '?v=' + Date.now(),
      getManifest: () => ({ version: 'dev' }),
      // background worker stand-in
      async sendMessage(msg) {
        await new Promise((r) => setTimeout(r, 200));
        if (msg.type === 'mal-list') {
          return { items: Array.from({ length: 30 }, (_, i) => ({ anime_id: 50000 + (1000 + 10 + i) * 10, score: (i * 7) % 11, status: [2, 2, 1, 4, 6][i % 5] })) };
        }
        if (msg.type === 'notify-poll') {
          const st = { ok: true, mode: 'crunchyroll', found: 0, ts: Date.now() };
          await window.chrome.storage.local.set({ 'notify:status': st });
          return st;
        }
        return { ok: true };
      },
    },
  };

  // ---- synthetic catalog ----
  const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Seinen', 'Shonen', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
  const WORDS = ['Blade', 'Crimson', 'Spirit', 'Academy', 'Chronicle', 'Moon', 'Dragon', 'Hero', 'Shadow', 'Café', 'Star', 'Witch', 'Kingdom', 'Ramen', 'Ghost', 'Summer', 'Mecha', 'Detective', 'Idol', 'Volley', 'Tokyo', 'Frontier', 'Apothecary', 'Journey'];
  const LANGS = ['ja-JP', 'en-US', 'es-419', 'es-ES', 'pt-BR', 'fr-FR', 'de-DE', 'it-IT'];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const poster = (title, h, w = 240, ht = 360) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,45%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},60%,18%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="${ht > w ? 80 : 50}%" fill="white" font-family="sans-serif" font-weight="700" font-size="${w / 11}" text-anchor="middle">${title.replace(/&/g, '&amp;')}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  const imgs = (title, h, kind) => kind === 'thumbnail'
    ? { thumbnail: [[{ width: 640, height: 360, type: 'thumbnail', source: poster(title, h, 640, 360) }]] }
    : { poster_tall: [[{ width: 240, height: 360, type: 'poster_tall', source: poster(title, h) }]], poster_wide: [[{ width: 640, height: 360, type: 'poster_wide', source: poster(title, h, 640, 360) }]] };

  const SERIES = Array.from({ length: 160 }, (_, i) => {
    const title = `${pick(WORDS)} ${pick(WORDS)}${rnd() < 0.3 ? ' ' + (2 + Math.floor(rnd() * 3)) : ''}`;
    const hue = Math.floor(rnd() * 360);
    const g = [...new Set([pick(GENRES), pick(GENRES), pick(GENRES)])].slice(0, 1 + Math.floor(rnd() * 3));
    const avg = 3.4 + rnd() * 1.6;
    const p5 = Math.round(40 + (avg - 3.4) * 35);
    const dist = [Math.max(1, Math.round((100 - p5) * 0.1)), Math.round((100 - p5) * 0.1), Math.round((100 - p5) * 0.2), 0, p5];
    dist[3] = Math.max(0, 100 - dist[0] - dist[1] - dist[2] - dist[4]);
    const movie = i % 17 === 0;
    const airing = !movie && i < 40;
    const seasons = movie ? 1 : airing ? 1 + (i % 2) : 1 + Math.floor(rnd() * 3);
    const perSeason = movie ? 1 : rnd() < 0.5 ? 12 : 24;
    const audio = ['ja-JP', ...LANGS.slice(1).filter(() => rnd() < 0.45)];
    return {
      id: 'GS' + String(1000 + i), type: movie ? 'movie_listing' : 'series', title, slug_title: title.toLowerCase().replace(/\s+/g, '-'),
      description: `${title} es una serie de ${g.join(', ').toLowerCase()} donde nada es lo que parece. Descripción generada para el entorno de desarrollo.`,
      images: imgs(title, hue),
      _hue: hue, _airing: airing, _seasons: seasons, _per: perSeason, _weekday: i % 7, _released: 1 + (i % 9),
      series_metadata: {
        episode_count: movie ? 1 : seasons * perSeason, season_count: seasons,
        tenant_categories: g, is_dubbed: audio.length > 1, is_subbed: true, is_simulcast: airing, series_launch_year: airing ? 2026 : 1998 + Math.floor(rnd() * 28),
        audio_locales: audio, subtitle_locales: ['en-US', 'es-ES', 'es-419', 'pt-BR', 'fr-FR', 'de-DE'],
        maturity_ratings: [rnd() < 0.15 ? 'TV-MA' : 'TV-14'], is_mature: false,
      },
      rating: { average: avg.toFixed(1), total: Math.floor(rnd() * rnd() * 200000) + 20, ...Object.fromEntries(dist.map((p, k) => [`${k + 1}s`, { displayed: '1', unit: 'K', percentage: p }])) },
      _season: airing ? 'fall-2026' : i < 70 ? 'summer-2026' : null,
    };
  });
  SERIES.sort((a, b) => b.rating.total - a.rating.total); // popularity ≈ votes
  const byId = new Map(SERIES.map((s) => [s.id, s]));

  // ---- seasons & episodes (weekly schedule for airing shows) ----
  const releaseAt = (s, n) => {
    // latest season: weekly on s._weekday at 15:00; episode `_released` is the newest
    const base = new Date(NOW);
    base.setHours(15, 0, 0, 0);
    base.setDate(base.getDate() - ((base.getDay() - s._weekday + 7) % 7));
    if (base.getTime() > NOW) base.setDate(base.getDate() - 7);
    return base.getTime() - (s._released - n) * 7 * DAY;
  };
  const lastRelease = (s) => (s._airing ? releaseAt(s, s._released) : NOW - (200 + (s._hue % 900)) * DAY);
  const clean = (s) => {
    const out = Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('_')));
    out.last_public = new Date(lastRelease(s)).toISOString();
    return out;
  };
  const seasonId = (s, k) => `${s.id}-S${k}`;
  const episodeOf = (s, k, n) => {
    const latest = k === s._seasons;
    const date = s._airing && latest ? releaseAt(s, n) : NOW - (400 + (s._seasons - k) * 200 - n) * DAY;
    return {
      id: `EP${s.id}-${k}-${n}`, type: 'episode', title: `Episodio ${n}: ${WORDS[(n + k) % WORDS.length]}`, slug_title: `ep-${n}`,
      images: imgs(`${s.title} T${k}E${n}`, s._hue, 'thumbnail'),
      episode_metadata: {
        series_id: s.id, series_title: s.title, series_slug_title: s.slug_title, season_id: seasonId(s, k), season_number: k,
        episode_number: n, sequence_number: n, duration_ms: 1420000, tenant_categories: s.series_metadata.tenant_categories,
        audio_locale: 'ja-JP', is_dubbed: false, premium_available_date: new Date(date).toISOString(),
        versions: [{ guid: `EP${s.id}-${k}-${n}`, audio_locale: 'ja-JP' }],
      },
    };
  };
  const flat = (panel) => ({ ...panel, ...panel.episode_metadata });
  const countIn = (s, k) => (s._airing && k === s._seasons ? s._released + 2 : s._per);
  const seasonsOf = (s) => Array.from({ length: s._seasons }, (_, i) => {
    const k = i + 1;
    return {
      id: seasonId(s, k), title: k === 1 ? s.title : `${s.title} T${k}`, season_number: k, season_sequence_number: k,
      season_display_number: String(k), number_of_episodes: countIn(s, k), audio_locale: 'ja-JP',
      versions: s.series_metadata.audio_locales.map((a) => ({ audio_locale: a, guid: a === 'ja-JP' ? seasonId(s, k) : `${seasonId(s, k)}-${a}` })),
    };
  });
  const episodesOf = (sid) => {
    const m = sid.match(/^(GS\d+)-S(\d+)/);
    const s = m && byId.get(m[1]);
    if (!s) return [];
    const k = +m[2];
    return Array.from({ length: countIn(s, k) }, (_, i) => flat(episodeOf(s, k, i + 1)));
  };

  // ---- the user ----
  const watched = SERIES.filter((s, i) => i % 9 === 3 && s.type === 'series').slice(0, 16);
  const HISTORY = watched.flatMap((s, si) => {
    const k = s._airing ? s._seasons : 1;
    const avail = s._airing ? s._released : s._per;
    const n = Math.min(avail, 2 + (si * 3) % 11);
    return Array.from({ length: n }, (_, j) => ({
      id: `EP${s.id}-${k}-${j + 1}`, date_played: new Date(NOW - (si * 9 + (n - j)) * DAY - ((si * 5 + j * 7) % 14) * 3600000).toISOString(),
      playhead: 1300, fully_watched: true, panel: episodeOf(s, k, j + 1),
    }));
  }).concat(
    // older viewing (more than a year ago: not followed by the agenda, but in the stats)
    SERIES.filter((_, i) => i % 9 === 4).slice(0, 14).flatMap((s, si) => Array.from({ length: Math.min(s._per, 4 + (si * 5) % 9) }, (_, j) => ({
      id: `EPold${s.id}-${j + 1}`, date_played: new Date(NOW - (380 + si * 23 + j) * DAY - ((si * 3 + j * 5) % 16) * 3600000).toISOString(),
      playhead: 1400, fully_watched: true, panel: episodeOf(s, 1, j + 1),
    }))),
  ).sort((a, b) => b.date_played.localeCompare(a.date_played));
  const WATCHLIST = SERIES.filter((_, i) => i % 7 === 1).slice(0, 18).concat(watched.slice(0, 5)).map((s, i) => ({
    new: i % 5 === 0, new_content: i % 5 === 0, is_favorite: i % 6 === 0, never_watched: !watched.includes(s), fully_watched: false,
    playhead: 0, panel: episodeOf(s, 1, 1),
  }));
  const CONTINUE = watched.slice(0, 7).map((s, i) => ({
    playhead: i % 3 === 2 ? 0 : 200 + i * 150, fully_watched: false, new: i === 1, panel: episodeOf(s, s._airing ? s._seasons : 1, 3),
  }));
  const LATEST = SERIES.filter((s) => s._airing).map((s) => episodeOf(s, s._seasons, s._released));

  // ---- AniList mock: most series link back to Crunchyroll, some only match by title ----
  const alOf = (s, k) => ({
    id: 100000 + parseInt(s.id.slice(2), 10) * 10 + k, idMal: 50000 + parseInt(s.id.slice(2), 10) * 10 + k,
    title: { romaji: s.title + (k ? ` ${k + 1}` : ''), english: s.title + (k ? ` Season ${k + 1}` : '') }, synonyms: [],
    averageScore: Math.round(55 + (parseFloat(s.rating.average) - 3.4) * 22 + (s._hue % 9) - 4 - k * 2),
    popularity: Math.round(s.rating.total * 1.7 / (k + 1)) + 200, startDate: { year: s.series_metadata.series_launch_year + k },
    format: s.type === 'movie_listing' ? 'MOVIE' : 'TV',
    externalLinks: s._hue % 10 < 8 ? [{ url: k ? `https://www.crunchyroll.com/${s.slug_title}` : `https://www.crunchyroll.com/series/${s.id}/${s.slug_title}` }] : [],
  });
  const TAGS = ['Isekai', 'Female Protagonist', 'Magic', 'School', 'Time Manipulation', 'Revenge', 'Food', 'Iyashikei', 'Female Harem', 'Super Power', 'Military', 'Demons', 'Detective', 'Survival', 'Coming of Age', 'Found Family'];
  const STUDIOS = ['MAPPA', 'Kyoto Animation', 'BONES', 'Studio Pierrot', 'Wit Studio', 'CloverWorks', 'ufotable', 'Madhouse'];
  const SOURCES = ['MANGA', 'LIGHT_NOVEL', 'ORIGINAL', 'VIDEO_GAME', 'MANGA', 'WEB_NOVEL'];
  const seriesOfAl = (id) => byId.get('GS' + Math.floor((id - 100000) / 10));
  const detailsOf = (id) => {
    const s = seriesOfAl(id);
    if (!s) return null;
    const k = id % 10;
    const h = s._hue;
    return {
      id, idMal: 50000 + parseInt(s.id.slice(2), 10) * 10 + k,
      genres: (h % 3 === 0 ? ['Mystery', 'Psychological'] : h % 3 === 1 ? ['Mecha'] : []),
      source: SOURCES[h % SOURCES.length], status: s._airing ? 'RELEASING' : 'FINISHED',
      tags: [0, 3, 7, 11].map((o, i) => ({ name: TAGS[(h + o) % TAGS.length], rank: 95 - i * 9, isMediaSpoiler: i === 3 && h % 2 === 0 })),
      studios: { nodes: [{ name: STUDIOS[h % STUDIOS.length] }] },
      trailer: h % 4 && !params.has('shots') ? { id: 'aqz-KE-bpKQ', site: 'youtube' } : null,   // ?shots: no third-party images
      nextAiringEpisode: s._airing ? { airingAt: Math.round((releaseAt(s, s._released + 1) - 3600000) / 1000), episode: s._released + 1 } : null,
      title: { english: s.title + (k ? ` Season ${k + 1}` : ''), romaji: s.title }, format: s.type === 'movie_listing' ? 'MOVIE' : 'TV',
      episodes: s._per, startDate: { year: s.series_metadata.series_launch_year + k, month: 4, day: 1 },
      // seasons chain; every 5th show also has a side-story film
      relations: { edges: [
        ...(k > 0 ? [{ relationType: 'PREQUEL', node: { id: id - 1, type: 'ANIME', relations: { edges: [] } } }] : []),
        ...(k + 1 < s._seasons ? [{ relationType: 'SEQUEL', node: { id: id + 1, type: 'ANIME', relations: { edges: [] } } }] : []),
        ...(h % 5 === 0 && k === 0 ? [{ relationType: 'SIDE_STORY', node: { id: 900000 + h, type: 'ANIME', relations: { edges: [] } } }] : []),
      ] },
    };
  };
  const filmOf = (id) => ({
    id, idMal: null, genres: [], source: 'MANGA', status: 'FINISHED', tags: [], studios: { nodes: [] }, trailer: null, nextAiringEpisode: null,
    title: { english: 'Película especial ' + (id - 900000), romaji: '' }, format: 'MOVIE', episodes: 1, startDate: { year: 2021, month: 8, day: 1 },
    relations: { edges: [] }, externalLinks: [],
  });
  const anilistMock = async (body) => {
    await delay(150);
    const data = {};
    const q = String(body.query || '');
    const respond = (d) => new Response(JSON.stringify({ data: d }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-ratelimit-remaining': '29' } });
    if (q.includes('MediaListCollection')) {
      const ST = ['COMPLETED', 'COMPLETED', 'CURRENT', 'DROPPED', 'PLANNING', 'COMPLETED', 'PAUSED'];
      const entries = SERIES.slice(20, 60).filter((x) => x._hue % 10 < 8).map((x, i) => ({
        mediaId: 100000 + parseInt(x.id.slice(2), 10) * 10, status: ST[i % ST.length],
        score: ST[i % ST.length] === 'PLANNING' ? 0 : 40 + (x._hue % 60),
      }));
      return respond({ MediaListCollection: { user: { name: body.variables.u }, lists: [{ entries }] } });
    }
    if (q.includes('id_in') || q.includes('idMal_in')) {
      const mal = q.includes('idMal_in');
      const ids = body.variables.ids || [];
      const media = ids.map((id) => (mal ? id - 50000 + 100000 : id))
        .map((id) => (id >= 900000 ? filmOf(id) : detailsOf(id))).filter(Boolean)
        .map((d) => (d.format === 'MOVIE' && d.id >= 900000 ? d : { ...d, externalLinks: [{ url: `https://www.crunchyroll.com/series/${seriesOfAl(d.id).id}` }] }));
      return respond({ Page: { media } });
    }
    Object.entries(body.variables || {}).forEach(([k, term]) => {
      const t = String(term).toLowerCase();
      const hits = SERIES.filter((s) => s._hue % 10 !== 9 && s.slug_title.replace(/-/g, ' ').startsWith(t)).slice(0, 2);
      data['q' + k.slice(1)] = { media: hits.flatMap((s) => (s._seasons > 1 ? [alOf(s, 0), alOf(s, 1)] : [alOf(s, 0)])) };
    });
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-ratelimit-remaining': '29' } });
  };

  // ---- fetch mock ----
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.hostname === 'graphql.anilist.co') return anilistMock(JSON.parse(init.body || '{}'));
    if (url.hostname === 'api.jikan.moe') {
      // /anime/{id}/episodes: some entries have filler (every 7th, plus 30–36) and recaps (every 25th)
      const ep = url.pathname.match(/\/anime\/(\d+)\/episodes$/);
      if (ep) {
        const id = +ep[1];
        const total = 24 + (id % 5) * 24;
        const page = +(url.searchParams.get('page') || 1);
        const withFiller = id % 4 === 0;
        const data = [];
        for (let n = (page - 1) * 100 + 1; n <= Math.min(total, page * 100); n++) {
          data.push({ mal_id: n, title: 'Episode ' + n, filler: withFiller && (n % 7 === 0 || (n >= 30 && n <= 36) || (id % 16 === 0 && n >= 13 && n <= 15)), recap: withFiller && n % 25 === 0 });
        }
        return json({ pagination: { last_visible_page: Math.ceil(total / 100), has_next_page: page * 100 < total }, data });
      }
      const id = +url.pathname.split('/').pop();
      return json({ data: { score: 6 + (id % 35) / 10, scored_by: 1000 * (id % 900), rank: id % 3000, url: `https://myanimelist.net/anime/${id}` } });
    }
    if (url.hostname !== 'www.crunchyroll.com') return realFetch(input, init);
    await delay(60 + rnd() * 200);
    const p = url.pathname;
    const q = url.searchParams;
    const n = Math.min(100, +(q.get('n') || 20));
    const start = +(q.get('start') || 0);
    let m;

    if (p === '/auth/v1/token') {
      const body = String(init.body || '');
      if (body.includes('etp_rt_cookie') && LOGGED_OUT) return json({ error: 'invalid_request' }, 400);
      // ?tokenfail: every token request is blocked (e.g. Cloudflare) while the data saver is on
      if (params.has('tokenfail') && CRP.api.isPageless()) return json({ error: 'blocked' }, 403);
      return json({ access_token: 'dev', expires_in: 3600, token_type: 'Bearer', account_id: body.includes('client_id') ? undefined : 'acc', profile_id: 'prof', country: 'ES' });
    }
    if (p === '/content/v2/discover/seasonal_tags') return json({ data: [{ id: 'fall-2026', localization: { title: 'Otoño 2026' } }, { id: 'summer-2026', localization: { title: 'Verano 2026' } }] });
    if (p === '/content/v1/tenant_categories') {
      // titles in the site language, like the real API (Spanish for es-*, English otherwise)
      const es = /^es/.test(q.get('locale') || '');
      const ES = { Action: 'Acción', Adventure: 'Aventura', Comedy: 'Comedia', Fantasy: 'Fantasía', 'Sci-Fi': 'Ciencia Ficción', Shonen: 'Shounen', 'Slice of Life': 'Recuentos de la Vida', Sports: 'Deportes', Supernatural: 'Sobrenatural' };
      return json({ items: GENRES.map((g) => ({ tenant_category: g.toLowerCase(), localization: { title: es ? ES[g] || g : g } })) });
    }
    if (p === '/content/v2/discover/browse') {
      if (q.get('type') === 'episode') return json({ total: LATEST.length, data: LATEST.slice(start, start + n) });
      let list = SERIES;
      if (q.get('seasonal_tag')) list = list.filter((s) => s._season === q.get('seasonal_tag'));
      if (q.get('categories')) { const cs = q.get('categories').split(','); list = list.filter((s) => cs.every((c) => s.series_metadata.tenant_categories.some((g) => g.toLowerCase() === c))); }
      return json({ total: list.length, data: list.slice(start, start + n).map(clean) });
    }
    if (p === '/content/v2/discover/search') {
      const term = (q.get('q') || '').toLowerCase();
      const items = SERIES.filter((s) => s.title.toLowerCase().includes(term)).slice(0, n).map(clean);
      return json({ data: [{ type: 'series', count: items.length, items }] });
    }
    if ((m = p.match(/^\/content\/v2\/(?:discover\/\w+\/)?similar_to\/(\w+)$/)) || (m = p.match(/^\/content\/v2\/discover\/similar_to\/(\w+)$/))) {
      const src = byId.get(m[1]);
      const g = src ? src.series_metadata.tenant_categories : [];
      const list = SERIES.filter((s) => s.id !== m[1]).map((s) => ({ s, k: s.series_metadata.tenant_categories.filter((x) => g.includes(x)).length + rnd() }))
        .sort((a, b) => b.k - a.k).slice(0, n).map((x) => clean(x.s));
      return json({ total: list.length, data: list });
    }
    if ((m = p.match(/^\/content\/v2\/cms\/objects\/(.+)$/))) return json({ data: m[1].split(',').map((id) => byId.get(id)).filter(Boolean).map(clean) });
    if ((m = p.match(/^\/content\/v2\/cms\/series\/(\w+)\/seasons$/))) { const s = byId.get(m[1]); return json({ data: s ? seasonsOf(s) : [] }); }
    if ((m = p.match(/^\/content\/v2\/cms\/series\/(\w+)$/))) { const s = byId.get(m[1]); return json({ data: s ? [{ ...clean(s), description: s.description + ' Esta es la descripción completa, más larga que la del listado.' }] : [] }); }
    if ((m = p.match(/^\/content\/v2\/cms\/seasons\/([\w-]+)\/episodes$/))) return json({ data: episodesOf(m[1]) });
    if ((m = p.match(/^\/content\/v2\/discover\/up_next\/(\w+)$/))) {
      const s = byId.get(m[1]);
      return json({ data: s ? [{ panel: episodeOf(s, 1, 1), playhead: 0, never_watched: true, fully_watched: false }] : [] });
    }
    if (LOGGED_OUT) return json({ error: 'unauthorized' }, 401);
    if (p === '/content/v2/discover/acc/history') return json({ data: CONTINUE });
    if (p === '/content/v2/acc/watch-history') return json({ data: HISTORY, meta: {} });
    if (p === '/content/v2/discover/acc/watchlist') return json({ total: WATCHLIST.length, data: WATCHLIST.slice(start, start + n) });
    if (p.startsWith('/content/v2/acc/watchlist')) return new Response(null, { status: 204 });
    if (p.startsWith('/content/v2/discover/acc/mark_as_watched/') || p.startsWith('/content/v2/acc/watch-history/')) return new Response(null, { status: 204 });
    if (p.startsWith('/content-reviews/v2/user/acc/rating/')) return json({ rating: JSON.parse(init.body || '{}').rating });
    if (p.startsWith('/content-reviews/v3/user/acc/rating/')) return json({ rating: '' });
    console.warn('[mock] unhandled', p);
    return json({ error: 'not mocked' }, 404);
  };
})();
