// Normalizes Crunchyroll API panels into small plain objects the UI and the
// recommender work with (and that are cheap to cache).
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.model = (() => {
  const { pickImage, scoreRating, localePrefix } = CRP.util;

  // Genre ids are Crunchyroll's tenant_category ids ("action", "slice of life"...).
  // Panels report categories either in English or localized, so map both to the id.
  const genreIndex = new Map();
  const genreTitles = new Map();
  const BASE_GENRES = ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'music', 'romance', 'sci-fi', 'seinen', 'shojo', 'shonen', 'slice of life', 'sports', 'supernatural', 'thriller'];
  const ES_TITLES = {
    action: 'Acción', adventure: 'Aventura', comedy: 'Comedia', drama: 'Drama', fantasy: 'Fantasía', music: 'Música',
    romance: 'Romance', 'sci-fi': 'Ciencia ficción', seinen: 'Seinen', shojo: 'Shojo', shonen: 'Shonen',
    'slice of life': 'Recuentos de la vida', sports: 'Deportes', supernatural: 'Sobrenatural', thriller: 'Thriller',
  };
  for (const g of BASE_GENRES) genreIndex.set(g, g);
  for (const [alias, id] of [['shoujo', 'shojo'], ['shounen', 'shonen'], ['science fiction', 'sci-fi'], ['musical', 'music']]) genreIndex.set(alias, id);

  function setCategories(items) {
    for (const c of items || []) {
      const id = c.tenant_category || c.id;
      if (!id) continue;
      const title = c.localization && c.localization.title;
      genreIndex.set(id.toLowerCase(), id);
      if (title) { genreIndex.set(title.toLowerCase(), id); genreTitles.set(id, title); }
    }
  }
  const genreId = (name) => genreIndex.get(String(name).toLowerCase()) || null;
  // Titles come localized from the API (site language); until then, translated defaults.
  // Crunchyroll's own (site-language) names when the UI speaks that language too.
  const siteLangUI = () => CRP.i18n.locale().split('-')[0] === CRP.util.contentLocale().split('-')[0];
  const genreTitle = (id) => (siteLangUI() && genreTitles.get(id)) || (ES_TITLES[id] ? t(ES_TITLES[id]) : genreTitles.get(id) || id);
  const allGenres = () => [...new Set([...BASE_GENRES, ...genreTitles.keys()])].map((id) => ({ id, title: genreTitle(id) }));
  const genresOf = (list) => [...new Set((list || []).map(genreId).filter(Boolean))];

  // series / movie_listing panels (browse, search, similar_to, cms/objects, watchlist)
  function series(item) {
    if (!item || !item.id) return null;
    const m = item.series_metadata || item.movie_listing_metadata || {};
    const r = item.rating;
    return {
      id: item.id,
      kind: item.type || 'series',
      title: item.title || '',
      slug: item.slug_title || '',
      description: item.description || item.promo_description || '',
      poster: pickImage(item.images, 'poster_tall', 200),
      wide: pickImage(item.images, 'poster_wide', 400),
      rating: r && r.average ? parseFloat(r.average) : null,
      votes: (r && r.total) || 0,
      quality: scoreRating(r),
      genres: genresOf(m.tenant_categories),
      episodes: m.episode_count || 0,
      seasons: m.season_count || 0,
      year: m.series_launch_year || null,
      dubbed: !!m.is_dubbed,
      subbed: !!m.is_subbed,
      simulcast: !!m.is_simulcast,
      mature: !!m.is_mature,
      maturity: (m.maturity_ratings && m.maturity_ratings[0]) || '',
      audio: m.audio_locales || [],
      subs: m.subtitle_locales || [],
      // % of 1..5 star votes
      dist: r && r['5s'] ? [1, 2, 3, 4, 5].map((k) => (r[k + 's'] && r[k + 's'].percentage) || 0) : null,
      lastPublic: item.last_public || m.date_updated || null,
    };
  }

  // Compact catalog record: a series() plus popularity rank, short description and
  // a normalized title/description for local search.
  function record(item, popRank) {
    const s = series(item);
    if (!s) return null;
    s.pop = popRank;
    if (s.description.length > 360) s.description = s.description.slice(0, 357).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  // episode / movie panels (history, continue watching, newly added)
  function episode(panel) {
    if (!panel || !panel.id) return null;
    const em = panel.episode_metadata;
    const mm = panel.movie_metadata;
    const m = em || mm || {};
    return {
      id: panel.id,
      kind: panel.type || (em ? 'episode' : 'movie'),
      title: panel.title || '',
      slug: panel.slug_title || '',
      seriesId: em ? em.series_id : mm && mm.movie_listing_id,
      seriesTitle: em ? em.series_title : mm && mm.movie_listing_title,
      seriesSlug: em ? em.series_slug_title : mm && mm.movie_listing_slug_title,
      season: em ? em.season_number : null,
      number: em ? (em.episode_number != null ? em.episode_number : em.episode) : null,
      durationMs: m.duration_ms || 0,
      thumb: pickImage(panel.images, 'thumbnail', 360),
      premium: !!m.is_premium_only,
      dubbed: !!m.is_dubbed,
      audio: m.audio_locale || null,
      airDate: (em && (em.premium_available_date || em.episode_air_date)) || null,
      genres: genresOf(m.tenant_categories),
      seasonId: em ? em.season_id : null,
      seq: em ? em.sequence_number : null,
      versions: ((m.versions || []).map((v) => v.guid)),
    };
  }

  // Flat episode objects from /cms/seasons/{id}/episodes
  function cmsEpisode(e) {
    if (!e || !e.id) return null;
    return {
      id: e.id,
      kind: 'episode',
      title: e.title || '',
      slug: e.slug_title || '',
      seriesId: e.series_id,
      seriesTitle: e.series_title,
      seriesSlug: e.series_slug_title,
      season: e.season_number,
      seasonId: e.season_id,
      number: e.episode_number != null ? e.episode_number : e.episode,
      seq: e.sequence_number,
      durationMs: e.duration_ms || 0,
      thumb: pickImage(e.images, 'thumbnail', 360),
      audio: e.audio_locale || null,
      airDate: e.premium_available_date || e.episode_air_date || null,
      versions: (e.versions || []).map((v) => v.guid),
      byAudio: Object.fromEntries((e.versions || []).map((v) => [v.audio_locale, v.guid])),
    };
  }

  const prefix = () => localePrefix();
  const seriesUrl = (s) => `${prefix()}/series/${s.id}/${s.slug || ''}`;
  const episodeUrl = (e) => `${prefix()}/watch/${e.id}/${e.slug || ''}`;
  const seriesUrlOfEpisode = (e) => `${prefix()}/series/${e.seriesId}/${e.seriesSlug || ''}`;
  const searchUrl = (q) => `${prefix()}/search?q=${encodeURIComponent(q)}`;
  const siteUrl = (path) => `${prefix()}${path}`;

  function epLabel(e) {
    if (e.kind === 'movie') return t('Película');
    const parts = [];
    if (e.season) parts.push(t('T{n}', { n: e.season }));
    if (e.number != null && e.number !== '') parts.push(t('E{n}', { n: e.number }));
    return parts.join(' · ');
  }

  return { setCategories, genreId, genreTitle, allGenres, genresOf, series, record, episode, cmsEpisode, seriesUrl, episodeUrl, seriesUrlOfEpisode, searchUrl, siteUrl, epLabel };
})();
