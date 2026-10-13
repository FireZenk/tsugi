// Agenda & backlog. For every series the user follows (recent history + watchlist):
//   · where they are (last watched episode, in the audio they watch it in),
//   · how many episodes are pending and how long that takes,
//   · whether it's airing, when the next episode drops, and this week's releases.
// Uses /cms/series/{id}/seasons + /cms/seasons/{id}/episodes; cached per series and
// last-watched episode, so it only recomputes when something changes.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.agenda = (() => {
  const M = CRP.model;
  const api = CRP.api;
  const store = CRP.store;
  const { pool, weekStart } = CRP.util;
  const DAY = 86400000;
  const TTL = 3 * 3600 * 1000;
  const AIRING_DAYS = 14;
  const ABANDONED_DAYS = 60;
  const MAX_SERIES = 36;
  const DEFAULT_EP_MIN = 24;

  const seasonMatches = (season, seasonId) => season.id === seasonId || (season.versions || []).some((v) => v.guid === seasonId);
  // The season id for the audio the user watches in (dubs are separate "versions").
  const seasonFor = (season, audio) => {
    const v = (season.versions || []).find((x) => x.audio_locale === audio);
    return v ? v.guid : season.id;
  };
  const available = (e, now) => !e.airDate || Date.parse(e.airDate) <= now;
  const after = (e, last) => (e.seq != null && last.seq != null ? e.seq > last.seq : +e.number > +last.number);

  async function forSeries(f, now) {
    const last = f.stats && f.stats.lastEntry;
    const lastEp = last ? M.episode(last.panel) : null;
    const audio = (lastEp && lastEp.audio) || 'ja-JP';
    const cacheKey = `ag:${f.id}:${lastEp ? lastEp.id : 'none'}:${last && last.fully_watched ? 1 : 0}:${audio}`;
    const cached = await store.cacheGet(cacheKey, TTL);
    if (cached) return cached;

    const seasons = (await api.seasons(f.id)).filter((s) => !s.is_clip)
      .sort((a, b) => (a.season_sequence_number || a.season_number || 0) - (b.season_sequence_number || b.season_number || 0));
    if (!seasons.length) return null;
    const latest = seasons[seasons.length - 1];
    let idx = lastEp ? seasons.findIndex((s) => seasonMatches(s, lastEp.seasonId)) : -1;
    if (lastEp && idx < 0) idx = Math.max(0, seasons.findIndex((s) => s.season_number === lastEp.season));

    const fetchEps = async (season) => (await api.episodes(seasonFor(season, audio))).map(M.cmsEpisode).filter(Boolean);
    const curEps = idx >= 0 ? await fetchEps(seasons[idx]) : [];
    const latestEps = idx === seasons.length - 1 ? curEps : await fetchEps(latest);

    // ---- backlog ----
    let pending = [];
    let extraEps = 0;      // episodes in seasons we didn't fetch
    if (lastEp) {
      const inCur = curEps.filter((e) => available(e, now) && (after(e, lastEp) || (e.id === lastEp.id && !last.fully_watched)));
      pending = pending.concat(inCur);
      for (let i = idx + 1; i < seasons.length - 1; i++) extraEps += seasons[i].number_of_episodes || 0;
      if (idx < seasons.length - 1) pending = pending.concat(latestEps.filter((e) => available(e, now)));
    }
    const avgMin = (curEps.concat(latestEps).reduce((a, e) => a + e.durationMs, 0) / Math.max(1, curEps.length + latestEps.length)) / 60000 || DEFAULT_EP_MIN;
    const pendingCount = pending.length + extraEps;
    const pendingMin = pending.reduce((a, e) => a + (e.durationMs / 60000 || avgMin), 0) + extraEps * avgMin;
    // play the version in the audio the user watches it in
    const first = pending[0] || null;
    const next = first && first.byAudio && first.byAudio[audio] ? { ...first, id: first.byAudio[audio] } : first;
    const totalEps = seasons.reduce((a, s) => a + (s.number_of_episodes || 0), 0);

    // ---- schedule ----
    const avail = latestEps.filter((e) => available(e, now) && e.airDate);
    const lastRelease = avail.length ? Math.max(...avail.map((e) => Date.parse(e.airDate))) : 0;
    const airing = !!lastRelease && now - lastRelease < AIRING_DAYS * DAY;
    const upcoming = latestEps.filter((e) => e.airDate && Date.parse(e.airDate) > now).sort((a, b) => Date.parse(a.airDate) - Date.parse(b.airDate));
    let nextRelease = upcoming[0] ? Date.parse(upcoming[0].airDate) : null;
    let predicted = false;
    if (!nextRelease && airing) { nextRelease = lastRelease + 7 * DAY; predicted = true; }
    const releases = latestEps.filter((e) => e.airDate).map((e) => ({ t: Date.parse(e.airDate), ep: e }));
    if (predicted && nextRelease) {
      const lastE = avail.find((e) => Date.parse(e.airDate) === lastRelease);
      releases.push({ t: nextRelease, ep: lastE ? { ...lastE, id: null, number: (+lastE.number || 0) + 1, title: '' } : null, predicted: true });
    }

    const out = {
      id: f.id,
      title: f.title || (lastEp && lastEp.seriesTitle) || '',
      slug: f.slug || (lastEp && lastEp.seriesSlug) || '',
      audio,
      started: !!lastEp,
      lastWatched: f.stats ? f.stats.last : 0,
      lastEp,
      pendingCount,
      pendingMin,
      next,
      totalEps,
      airing,
      nextRelease,
      predicted,
      releases: releases.filter((r) => now - r.t < 10 * DAY && r.t - now < 10 * DAY),
    };
    await store.cacheSet(cacheKey, out);
    return out;
  }

  /**
   * @param o { stats: Map, watchlist: [], watchedIds: Set, onProgress }
   */
  async function build(o) {
    const now = Date.now();
    const follow = new Map();
    for (const s of o.stats.values()) {
      if (now - s.last < 365 * DAY) follow.set(s.id, { id: s.id, title: s.title, slug: s.slug, stats: s, inList: false });
    }
    for (const w of o.watchlist) {
      const f = follow.get(w.seriesId);
      if (f) f.inList = true;
      else follow.set(w.seriesId, { id: w.seriesId, title: w.title, slug: w.series && w.series.slug, stats: null, inList: true, favorite: w.favorite });
    }
    const list = [...follow.values()]
      .sort((a, b) => ((b.stats && b.stats.last) || 0) - ((a.stats && a.stats.last) || 0) || (b.inList ? 1 : 0) - (a.inList ? 1 : 0))
      .slice(0, MAX_SERIES);

    let done = 0;
    const results = await pool(list, 4, async (f) => {
      const r = await forSeries(f, now);
      o.onProgress && o.onProgress(++done / list.length);
      return r ? { ...r, inList: f.inList } : null;
    });
    const series = results.filter(Boolean);

    for (const s of series) {
      // AniList knows the broadcast schedule (breaks, delays, first episodes). Our own
      // estimate keeps Crunchyroll's exact time of day, so only override when AniList
      // disagrees by more than a day or we had nothing. Original-audio viewers only:
      // dubs follow their own schedule.
      const nx = CRP.ext && CRP.ext.nextAiring(s.id);
      if (nx && (!s.audio || s.audio === 'ja-JP') && (s.predicted || !s.nextRelease)) {
        const at = nx.at + 3600000; // Japanese broadcast → Crunchyroll, typically within the hour
        if (!s.nextRelease || Math.abs(at - s.nextRelease) > 86400000) {
          s.releases = s.releases.filter((r) => !r.predicted);
          const lastEp = s.releases.length ? s.releases[s.releases.length - 1].ep : null;
          s.releases.push({ t: at, ep: lastEp ? { ...lastEp, id: null, number: nx.ep, title: '' } : { id: null, number: nx.ep }, predicted: true, source: 'anilist' });
          s.nextRelease = at;
          s.predicted = true;
          s.airing = true;
        }
      }
      s.releases.forEach((r) => {
        r.watched = !!(r.ep && r.ep.id && (o.watchedIds.has(r.ep.id) || (r.ep.versions || []).some((v) => o.watchedIds.has(v))));
      });
      const idle = s.lastWatched ? (now - s.lastWatched) / DAY : Infinity;
      s.state = !s.started ? 'unstarted'
        : s.pendingCount === 0 ? 'uptodate'
          : idle > ABANDONED_DAYS ? 'abandoned' : 'active';
    }

    const active = series.filter((s) => s.state === 'active');
    const ws = weekStart(new Date(now)).getTime();
    const week = Array.from({ length: 7 }, (_, i) => ({ date: new Date(ws + i * DAY), items: [] }));
    for (const s of series) {
      if (s.state === 'unstarted' && !s.inList) continue;
      for (const r of s.releases) {
        const d = Math.floor((r.t - ws) / DAY);
        if (d >= 0 && d < 7) week[d].items.push({ series: s, ...r });
      }
    }
    week.forEach((d) => d.items.sort((a, b) => a.t - b.t));

    return {
      builtAt: now,
      series,
      week,
      totals: {
        pending: active.reduce((a, s) => a + s.pendingCount, 0),
        minutes: active.reduce((a, s) => a + s.pendingMin, 0),
        active: active.length,
        upToDate: series.filter((s) => s.state === 'uptodate').length,
        abandoned: series.filter((s) => s.state === 'abandoned').length,
      },
    };
  }

  return { build };
})();
