// Natural-language query → filter state. Understands Spanish phrases such as
// "corta, en castellano, como Frieren, nota 4.5, sin romance, terminada".
// Each recognised fragment becomes a chip (with its span in the input, so removing the
// chip can remove the words); what's left over is used as free text.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.query = (() => {
  const { norm, langName } = CRP.util;
  const M = CRP.model;
  const EP = '(?:ep|eps|episodios?|caps?|capitulos?)';
  const YEAR = '((?:19|20)\\d\\d)';

  const STOP = new Set(('algo una un unas unos de del la las el los en con que y o para me quiero busco anime animes series serie ' +
    'ver tipo pero muy mas sea sean al a por favor recomiendame dame alguna algun ni sin no episodios capitulos temporadas ' +
    'temporada estilo rollo algo parecido parecida bien es son esta este estas estos mi mis tenga tengan').split(' '));

  // [alias, genre id]; plural/feminine variants generated below
  const GENRE_ALIASES = [
    ['accion', 'action'], ['aventura', 'adventure'], ['comedia', 'comedy'], ['humor', 'comedy'], ['drama', 'drama'],
    ['fantasia', 'fantasy'], ['musica', 'music'], ['musical', 'music'],
    ['romance', 'romance'], ['romantica', 'romance'], ['romantico', 'romance'], ['amor', 'romance'],
    ['ciencia ficcion', 'sci-fi'], ['scifi', 'sci-fi'], ['sci-fi', 'sci-fi'], ['sci fi', 'sci-fi'],
    ['seinen', 'seinen'], ['shojo', 'shojo'], ['shoujo', 'shojo'], ['shonen', 'shonen'], ['shounen', 'shonen'],
    ['recuentos de la vida', 'slice of life'], ['slice of life', 'slice of life'], ['vida cotidiana', 'slice of life'], ['cotidiana', 'slice of life'],
    ['deporte', 'sports'], ['deportiva', 'sports'], ['deportivo', 'sports'],
    ['sobrenatural', 'supernatural'], ['paranormal', 'supernatural'], ['fantasmas', 'supernatural'],
    ['thriller', 'thriller'], ['suspense', 'thriller'], ['suspenso', 'thriller'],
    ['action', 'action'], ['adventure', 'adventure'], ['comedy', 'comedy'], ['fantasy', 'fantasy'], ['sports', 'sports'], ['supernatural', 'supernatural'],
  ];
  const variants = (w) => {
    const out = [w];
    if (/[aeo]$/.test(w)) out.push(w + 's');
    if (/o$/.test(w)) out.push(w.slice(0, -1) + 'a', w.slice(0, -1) + 'as');
    if (/[^aeious]$/.test(w) && !w.includes(' ')) out.push(w + 'es');
    return out;
  };
  const genreMap = new Map();
  for (const [a, id] of GENRE_ALIASES) for (const v of variants(a)) genreMap.set(v, id);
  const genreAlt = [...genreMap.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[-]/g, '\\-')).join('|');

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function rules(opts) {
    const year = new Date().getFullYear();
    const dub = opts.dub || 'es-ES';
    const spanish = dub === 'es-419' ? 'es-419' : 'es-ES';
    const cur = opts.currentSeason;
    const r = [];
    const add = (re, apply, label, extra = {}) => r.push({ re, apply, label, ...extra });

    // "como Frieren" — resolved against the catalog by the caller
    r.push({ re: /\b(?:como|parecid[ao]s? a|similar(?:es)? a|tipo|al estilo de|estilo|rollo)\s+([^,;]+)/g, like: true });

    add(/\b(?:sin ver|no vistas?|que no he visto|nuevas para mi|por descubrir)\b/g, () => ({ mine: 'unseen' }), 'Sin ver');
    add(/\b(?:en mi lista|de mi lista|mi lista)\b/g, () => ({ mine: 'watchlist' }), 'En mi lista');
    add(/\b(?:a medias|empezadas?|en curso|que estoy viendo)\b/g, () => ({ mine: 'progress' }), 'Empezadas');
    add(/\b(?:ya vistas?|que he visto)\b/g, () => ({ mine: 'seen' }), 'Ya vistas');

    add(/\b(?:sin (?:contenido )?(?:adulto|\+18|gore)|para (?:todos|ninos|todas las edades)|familiar(?:es)?|aptas? para todos)\b/g, () => ({ noMature: true }), 'Sin +18');

    add(new RegExp(`(?:menos de|como mucho|maximo|max|hasta|<=?)\\s*(\\d{1,4})\\s*${EP}\\b`, 'g'), (m) => ({ epsMax: +m[1] }), (m) => `≤ ${m[1]} ep`);
    add(new RegExp(`(?:mas de|minimo|min|al menos|>=?)\\s*(\\d{1,4})\\s*${EP}\\b`, 'g'), (m) => ({ epsMin: +m[1] }), (m) => `≥ ${m[1]} ep`);
    add(new RegExp(`\\b(\\d{1,4})\\s*${EP}\\b`, 'g'), (m) => ({ epsMin: Math.max(1, +m[1] - 2), epsMax: +m[1] + 2 }), (m) => `~${m[1]} ep`);

    add(/\b(?:anilist|al)\s*(?:de\s*|>=?\s*|minim[oa]\s*)?(\d{2})\b/g, (m) => ({ alMin: +m[1] }), (m) => `AniList ≥ ${m[1]}`);
    add(/\b(?:mejor(?:es)? (?:en|segun) anilist|top anilist)\b/g, () => ({ alMin: 80 }), 'AniList ≥ 80', { sort: 'anilist' });
    const ratingOf = (m) => Math.min(5, parseFloat(m[1].replace(',', '.')));
    add(/(?:nota|rating|puntuacion|valoracion|estrellas?)\s*(?:de\s*|minima\s*|>=?\s*|mayor (?:de|que)\s*)?([1-5](?:[.,]\d)?)/g, (m) => ({ ratingMin: ratingOf(m) }), (m) => `★ ≥ ${ratingOf(m)}`);
    add(/(?:>=?|mas de)\s*([1-5][.,]\d)\b/g, (m) => ({ ratingMin: ratingOf(m) }), (m) => `★ ≥ ${ratingOf(m)}`);
    add(/\b(?:muy buenas?|las mejores|obras? maestras?|imprescindibles?)\b/g, () => ({ ratingMin: 4.7 }), '★ ≥ 4.7', { sort: 'rating' });
    add(/\b(?:buenas?|bien valoradas?|mejores|valoradas?)\b/g, () => ({ ratingMin: 4.5 }), '★ ≥ 4.5', { sort: 'rating' });

    add(new RegExp(`(?:\\b(?:desde|de|entre)\\s+)?\\b${YEAR}\\s*(?:-|a|al|hasta|y)\\s*${YEAR}\\b`, 'g'), (m) => ({ yearMin: +m[1], yearMax: +m[2] }), (m) => `${m[1]}–${m[2]}`);
    add(new RegExp(`\\b(?:desde|despues de|a partir de|posteriores? a)\\s+(?:el\\s+)?${YEAR}\\b`, 'g'), (m) => ({ yearMin: +m[1] }), (m) => `desde ${m[1]}`);
    add(new RegExp(`\\b(?:antes de|hasta|anteriores? a)\\s+(?:el\\s+)?${YEAR}\\b`, 'g'), (m) => ({ yearMax: +m[1] }), (m) => `hasta ${m[1]}`);
    add(/\b(?:anos\s+(?:19)?([5-9]0)|(?:19)?([5-9]0)s)\b/g, (m) => { const d = 1900 + +(m[1] || m[2]); return { yearMin: d, yearMax: d + 9 }; }, (m) => `años ${m[1] || m[2]}`);
    add(/\b(?:anos\s+(20[0-2]0)|(20[0-2]0)s)\b/g, (m) => { const d = +(m[1] || m[2]); return { yearMin: d, yearMax: d + 9 }; }, (m) => `${m[1] || m[2]}s`);
    add(new RegExp(`\\b${YEAR}\\b`, 'g'), (m) => ({ yearMin: +m[1], yearMax: +m[1] }), (m) => `año ${m[1]}`);
    add(/\b(?:recientes?|nuevas?|novedades|actuales?|modernas?|ultimas?)\b/g, () => ({ yearMin: year - 2 }), `desde ${year - 2}`);
    add(/\b(?:clasic[ao]s?|antigu[ao]s?|viej[ao]s?|retro)\b/g, () => ({ yearMax: 2009 }), 'Clásicas (≤ 2009)');

    add(/\b(?:muy cortas?|cortitas?|miniseries?|mini series?)\b/g, () => ({ epsMax: 12 }), '≤ 12 ep');
    add(/\b(?:cort[ao]s?|breves?|de una temporada|rapidas? de ver)\b/g, () => ({ len: 'short' }), 'Corta (≤ 13 ep)');
    add(/\b(?:muy largas?|eternas?|interminables?|maraton(?:es)?)\b/g, () => ({ len: 'huge' }), 'Muy larga (75+ ep)');
    add(/\b(?:larg[ao]s?)\b/g, () => ({ len: 'long' }), 'Larga (27–75 ep)');
    add(/\b(?:peli|pelis|peliculas?|films?|movies?)\b/g, () => ({ len: 'movie' }), 'Película');

    // optional "con audio en" / "doblada al" lead-in, so removing the chip removes it too
    const LEAD = '(?:(?:con )?(?:audio |doblaje |doblad[ao]s? )?(?:en |al ))?';
    add(new RegExp(`\\b${LEAD}(?:espanol latino|doblaje latino|latin[oa]s?|latam)\\b`, 'g'), () => ({ audio: ['es-419'] }), 'Audio latino');
    add(new RegExp(`\\b${LEAD}(?:espanol de espana|castellano|espanol)\\b`, 'g'), () => ({ audio: [spanish] }), `Audio ${langName(spanish).toLowerCase()}`);
    add(new RegExp(`\\b${LEAD}(?:ingles|english)\\b`, 'g'), () => ({ audio: ['en-US'] }), 'Audio inglés');
    add(/\b(?:doblad[ao]s?|doblaje|dub|dubbed)\b/g, () => ({ audio: [dub] }), `Doblada (${langName(dub).toLowerCase()})`);

    if (cur) add(/\b(?:esta temporada|temporada actual|de la temporada|de este trimestre)\b/g, () => ({ season: cur.id }), cur.title);
    add(/\b(?:en emision|emitiendose|en directo|simulcasts?|semanal(?:es)?|saliendo)\b/g, () => ({ status: 'airing' }), 'En emisión');
    add(/\b(?:terminad[ao]s?|acabad[ao]s?|complet[ao]s?|finalizad[ao]s?)\b/g, () => ({ status: 'finished' }), 'Terminada');


    add(/\b(?:joyas?(?: ocultas?)?|desconocidas?|poco conocidas?|infravaloradas?)\b/g, () => ({}), 'Joyas ocultas', { sort: 'gems' });
    add(/\b(?:populares?|famosas?|conocidas?|mas vistas?|de moda)\b/g, () => ({}), 'Populares', { sort: 'popular' });
    return r;
  }

  /**
   * @returns {{ F: object, chips: Array<{label, start, end, kind}>, sort: string|null, like: string|null, rest: string }}
   */
  function parse(text, opts = {}) {
    const t = norm(text);
    const used = new Array(t.length).fill(false);
    const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
    const take = (s, e) => { for (let i = s; i < e; i++) used[i] = true; };
    const F = { audio: [], genresIn: [], genresOut: [], tagsIn: [], tagsOut: [] };
    const chips = [];
    let sort = null;
    let like = null;

    for (const rule of rules(opts)) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(t))) {
        const start = m.index;
        let end = start + m[0].length;
        if (!free(start, end)) continue;
        if (rule.like) {
          // longest prefix of the captured words that names a real title
          const words = m[1].trim().split(/\s+/);
          // "tipo shonen", "como corta"… are filters, not titles
          if (genreMap.has(words[0]) || /^(cort|larg|castellan|latin|doblad|peli|terminad|buen|nota|joya|popular)/.test(words[0])) continue;
          let hit = null;
          for (let n = words.length; n > 0 && !hit; n--) {
            const cand = words.slice(0, n).join(' ');
            const found = opts.findTitle && opts.findTitle(cand);
            if (found) { hit = found; end = start + m[0].indexOf(words[0]) + cand.length; }
          }
          if (!hit) continue;
          like = hit;
          take(start, end);
          chips.push({ label: `Como ${hit.title}`, start, end, kind: 'like', fields: ['like'] });
          continue;
        }
        const patch = rule.apply(m);
        for (const [k, v] of Object.entries(patch)) {
          if (Array.isArray(v)) F[k] = [...new Set([...(F[k] || []), ...v])];
          else F[k] = v;
        }
        if (rule.sort) sort = rule.sort;
        take(start, end);
        const fields = Object.keys(patch).map((k) => (k === 'epsMin' || k === 'epsMax' ? 'len' : k === 'yearMin' || k === 'yearMax' ? 'year' : k));
        if (rule.sort) fields.push('sort');
        chips.push({ label: typeof rule.label === 'function' ? rule.label(m) : rule.label, start, end, kind: 'filter', fields });
      }
    }

    let m;
    const T = CRP.tags;
    // Source material: "basado en novela ligera", "de manga", "historia original"
    for (const [re, src] of T.SOURCE_RULES) {
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        const start = m.index;
        const end = start + m[0].length;
        if (!free(start, end)) continue;
        F.source = src;
        take(start, end);
        chips.push({ label: `Origen: ${T.sourceLabel(src)}`, start, end, kind: 'filter', fields: ['source'] });
      }
    }
    // Studio: "de mappa", "estudio bones", "animada por kyoani"
    const sre = T.studioRegex();
    if (sre) {
      sre.lastIndex = 0;
      while ((m = sre.exec(t))) {
        const start = m.index;
        const end = start + m[0].length;
        if (!free(start, end)) continue;
        F.studio = T.studioName(m[1]);
        take(start, end);
        chips.push({ label: `Estudio: ${F.studio}`, start, end, kind: 'filter', fields: ['studio'] });
      }
    }
    // Themes (AniList tags), with negation: "isekai sin harén", "ni gore"
    const tre = T.themeRegex();
    tre.lastIndex = 0;
    let lastNegT = -1;
    while ((m = tre.exec(t))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const name = T.aliases.get(m[3]);
      if (!name) continue;
      const neg = !!(m[1] || m[2]) && (m[1] !== 'ni' || lastNegT >= 0);
      if (neg) { lastNegT = end; F.tagsOut.push(name); } else { lastNegT = -1; F.tagsIn.push(name); }
      take(start, end);
      chips.push({ label: (neg ? 'Sin ' : '') + T.label(name), start, end, kind: neg ? 'neg' : 'filter', fields: ['tags'], tag: name });
    }
    F.tagsIn = [...new Set(F.tagsIn)];
    F.tagsOut = [...new Set(F.tagsOut)].filter((x) => !F.tagsIn.includes(x));

    // Genres, with negation: "sin romance", "no shonen", "ni comedia", "-drama"
    const gre = new RegExp(`(?:\\b(sin|no|nada de|excepto|menos|ni)\\s+|(-))?\\b(${genreAlt})\\b`, 'g');
    let lastNeg = -1;
    while ((m = gre.exec(t))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const id = genreMap.get(m[3]);
      if (!id) continue;
      // "sin romance ni comedia": "ni" continues a negation
      const neg = !!(m[1] || m[2]) && (m[1] !== 'ni' || lastNeg >= 0);
      if (neg) { lastNeg = end; F.genresOut.push(id); } else { lastNeg = -1; F.genresIn.push(id); }
      take(start, end);
      chips.push({ label: (neg ? 'Sin ' : '') + M.genreTitle(id), start, end, kind: neg ? 'neg' : 'filter', fields: ['genres'], genre: id });
    }
    F.genresIn = [...new Set(F.genresIn)];
    F.genresOut = [...new Set(F.genresOut)].filter((g) => !F.genresIn.includes(g));

    let rest = '';
    for (let i = 0; i < t.length; i++) rest += used[i] ? ' ' : text[i];
    rest = rest.split(/[\s,;]+/).filter((w) => w && !STOP.has(norm(w))).join(' ');
    chips.sort((a, b) => a.start - b.start);
    return { F, chips, sort, like, rest };
  }

  // Remove a chip's words from the original text (spans refer to it).
  function removeSpan(text, chip) {
    return (text.slice(0, chip.start) + text.slice(chip.end)).replace(/\s*,\s*,/g, ',').replace(/\s+,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ');
  }

  return { parse, removeSpan, esc };
})();
