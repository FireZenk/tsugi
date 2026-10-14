// Viewing statistics from the full Crunchyroll watch history (one entry per episode,
// its last play). Everything is computed locally; the slimmed history is cached.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.stats = (() => {
  const M = CRP.model;
  const DAY = 86400000;
  const KEY = 'stats:history';
  const TTL = 6 * 3600 * 1000;
  const DEFAULT_MIN = 24;

  // history entry -> { t, s, st, id, sec, fw, a, mv }
  function slim(entry) {
    const ep = M.episode(entry.panel);
    if (!ep || !ep.seriesId) return null;
    const dur = Math.round((ep.durationMs || 0) / 1000);
    const ph = entry.playhead || 0;
    const sec = entry.fully_watched ? (dur || ph || DEFAULT_MIN * 60) : Math.min(ph, dur || ph);
    return { t: Date.parse(entry.date_played) || 0, s: ep.seriesId, st: ep.seriesTitle || '', id: ep.id, sec, fw: entry.fully_watched ? 1 : 0, a: ep.audio || null, mv: ep.kind === 'movie' ? 1 : 0 };
  }

  // Full history (paged), slimmed and cached for a few hours.
  async function history({ force = false, onProgress } = {}) {
    const cached = !force && (await CRP.store.cacheGet(KEY, TTL));
    if (cached) return cached;
    let pages = 0;
    const raw = await CRP.api.watchHistory(200, 100, () => { pages += 1; if (onProgress) onProgress(pages); });
    const list = raw.map(slim).filter((e) => e && e.t);
    await CRP.store.cacheSet(KEY, list);
    return list;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const years = (list) => [...new Set(list.map((e) => new Date(e.t).getFullYear()))].sort((a, b) => b - a);

  // Longest run of consecutive days in a sorted list of day keys.
  function streak(days) {
    let best = { days: 0, from: null, to: null };
    let cur = null;
    for (const k of days) {
      const t = new Date(k + 'T12:00:00').getTime();
      if (cur && Math.round((t - cur.last) / DAY) === 1) { cur.days += 1; cur.last = t; cur.to = k; }
      else cur = { days: 1, from: k, to: k, last: t };
      if (cur.days > best.days) best = { days: cur.days, from: cur.from, to: cur.to };
    }
    return best;
  }

  /**
   * @param list   slimmed history
   * @param range  { from, to } ms (to exclusive) or null for everything
   * @param o      { genresOf(seriesId) -> [genreId], episodesOf(seriesId) -> n, airing(seriesId) -> bool }
   */
  function compute(list, range, o = {}) {
    const inRange = range ? list.filter((e) => e.t >= range.from && e.t < range.to) : list;
    const firstSeen = new Map();   // first time each series was ever watched (whole history)
    for (const e of list) if (!firstSeen.has(e.s) || e.t < firstSeen.get(e.s)) firstSeen.set(e.s, e.t);

    const byDay = new Map();
    const byMonth = new Map();
    const byHour = Array(24).fill(0);
    const byWeekday = Array(7).fill(0);
    const series = new Map();
    const genres = new Map();
    const audio = new Map();
    let sec = 0;
    for (const e of inRange) {
      const d = new Date(e.t);
      const m = e.sec / 60;
      sec += e.sec;
      byDay.set(dayKey(d), (byDay.get(dayKey(d)) || 0) + m);
      byMonth.set(monthKey(d), (byMonth.get(monthKey(d)) || 0) + m);
      byHour[d.getHours()] += m;
      byWeekday[d.getDay()] += m;
      let s = series.get(e.s);
      if (!s) { s = { id: e.s, title: e.st, minutes: 0, episodes: 0, first: e.t, last: e.t }; series.set(e.s, s); }
      s.minutes += m;
      s.episodes += 1;
      s.first = Math.min(s.first, e.t);
      s.last = Math.max(s.last, e.t);
      if (!s.title && e.st) s.title = e.st;
      for (const g of (o.genresOf && o.genresOf(e.s)) || []) genres.set(g, (genres.get(g) || 0) + m);
      const a = e.a || 'ja-JP';
      audio.set(a, (audio.get(a) || 0) + m);
    }
    const days = [...byDay.keys()].sort();
    const topSeries = [...series.values()].sort((a, b) => b.minutes - a.minutes);
    const started = topSeries.filter((s) => !range || (firstSeen.get(s.id) >= range.from && firstSeen.get(s.id) < range.to));
    const watchedAll = new Map();   // episodes watched per series, whole history
    for (const e of list) watchedAll.set(e.s, (watchedAll.get(e.s) || 0) + 1);
    const finished = topSeries.filter((s) => {
      const n = o.episodesOf && o.episodesOf(s.id);
      return n && watchedAll.get(s.id) >= Math.max(1, Math.floor(n * 0.9)) && !(o.airing && o.airing(s.id));
    });
    const maxBy = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    return {
      minutes: sec / 60,
      episodes: inRange.length,
      seriesCount: series.size,
      activeDays: days.length,
      streak: streak(days),
      byDay, byMonth, byHour, byWeekday,
      topSeries,
      topGenres: [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([id, minutes]) => ({ id, minutes })),
      audio: [...audio.entries()].sort((a, b) => b[1] - a[1]).map(([id, minutes]) => ({ id, minutes })),
      started,
      finished,
      busiestMonth: maxBy(byMonth),
      busiestDay: maxBy(byDay),
      favWeekday: byWeekday.some(Boolean) ? byWeekday.indexOf(Math.max(...byWeekday)) : null,
      favHour: byHour.some(Boolean) ? byHour.indexOf(Math.max(...byHour)) : null,
    };
  }

  const yearRange = (y) => ({ from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() });

  return { slim, history, compute, years, yearRange, streak, dayKey, monthKey };
})();
