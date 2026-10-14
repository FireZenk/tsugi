// Natural-language query → filter state. Understands phrases such as
//   es: "corta, en castellano, como Frieren, nota 4.5, sin romance, terminada"
//   en: "short, dubbed, like Frieren, rating 4.5, no romance, finished"
//   it: "corta, doppiata, come Frieren, senza romance, conclusa"
//   de: "kurz, synchronisiert, wie Frieren, ohne Romantik, abgeschlossen"
//   fr: "courte, VF, comme Frieren, sans romance, terminée"
// Spanish and English are always understood, plus the UI language. Each recognised
// fragment becomes a chip (with its span in the input, so removing the chip removes the
// words); what's left over is used as free text.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.query = (() => {
  const { norm, langName } = CRP.util;
  const M = CRP.model;
  const YEAR = '((?:19|20)\\d\\d)';

  // ------------------------------------------------------------- vocabulary
  const STOP_WORDS = {
    es: 'algo una un unas unos de del la las el los en con que y o para me quiero busco anime animes series serie ver tipo pero muy mas sea sean al a por favor recomiendame dame alguna algun ni sin no episodios capitulos temporadas temporada estilo rollo parecido parecida bien es son esta este estas estos mi mis tenga tengan',
    en: 'something some a an the with and or for me i want to watch of in that is are any show shows series anime please give like no without nor episodes season',
    it: 'qualcosa un una uno il lo la i gli le con e o per di da che in voglio vedere serie anime senza non ne episodi stagione',
    de: 'etwas ein eine einen der die das mit und oder fur ich will sehen von in auf anime serie serien ohne kein keine nicht noch folgen staffel',
    fr: 'quelque chose un une le la les avec et ou pour de des du en je veux voir anime serie series sans pas ni episodes saison',
  };

  // [alias, genre id]; variants (plural/feminine) generated below
  const GENRE_ALIASES = {
    es: [['accion', 'action'], ['aventura', 'adventure'], ['comedia', 'comedy'], ['humor', 'comedy'], ['drama', 'drama'],
      ['fantasia', 'fantasy'], ['musica', 'music'], ['musical', 'music'], ['romance', 'romance'], ['romantica', 'romance'],
      ['romantico', 'romance'], ['amor', 'romance'], ['ciencia ficcion', 'sci-fi'], ['recuentos de la vida', 'slice of life'],
      ['vida cotidiana', 'slice of life'], ['cotidiana', 'slice of life'], ['deporte', 'sports'], ['deportiva', 'sports'],
      ['deportivo', 'sports'], ['sobrenatural', 'supernatural'], ['paranormal', 'supernatural'], ['fantasmas', 'supernatural'],
      ['suspense', 'thriller'], ['suspenso', 'thriller']],
    en: [['action', 'action'], ['adventure', 'adventure'], ['comedy', 'comedy'], ['funny', 'comedy'], ['drama', 'drama'],
      ['fantasy', 'fantasy'], ['music', 'music'], ['romance', 'romance'], ['romantic', 'romance'], ['love', 'romance'],
      ['sci-fi', 'sci-fi'], ['sci fi', 'sci-fi'], ['scifi', 'sci-fi'], ['science fiction', 'sci-fi'], ['slice of life', 'slice of life'],
      ['sports', 'sports'], ['sport', 'sports'], ['supernatural', 'supernatural'], ['thriller', 'thriller'], ['suspense', 'thriller'],
      ['seinen', 'seinen'], ['shojo', 'shojo'], ['shoujo', 'shojo'], ['shonen', 'shonen'], ['shounen', 'shonen']],
    it: [['azione', 'action'], ['avventura', 'adventure'], ['commedia', 'comedy'], ['drammatico', 'drama'], ['dramma', 'drama'],
      ['fantasy', 'fantasy'], ['fantastico', 'fantasy'], ['musica', 'music'], ['musicale', 'music'], ['romantico', 'romance'],
      ['sentimentale', 'romance'], ['amore', 'romance'], ['fantascienza', 'sci-fi'], ['sport', 'sports'], ['sportivo', 'sports'],
      ['soprannaturale', 'supernatural'], ['thriller', 'thriller'], ['vita quotidiana', 'slice of life']],
    de: [['action', 'action'], ['abenteuer', 'adventure'], ['komodie', 'comedy'], ['lustig', 'comedy'], ['drama', 'drama'],
      ['fantasy', 'fantasy'], ['musik', 'music'], ['romantik', 'romance'], ['romantisch', 'romance'], ['liebe', 'romance'],
      ['science-fiction', 'sci-fi'], ['science fiction', 'sci-fi'], ['sport', 'sports'], ['ubernaturlich', 'supernatural'],
      ['thriller', 'thriller'], ['alltag', 'slice of life']],
    fr: [['action', 'action'], ['aventure', 'adventure'], ['comedie', 'comedy'], ['drole', 'comedy'], ['drame', 'drama'],
      ['fantasy', 'fantasy'], ['fantastique', 'fantasy'], ['musique', 'music'], ['musical', 'music'], ['romance', 'romance'],
      ['romantique', 'romance'], ['amour', 'romance'], ['science-fiction', 'sci-fi'], ['science fiction', 'sci-fi'], ['sport', 'sports'],
      ['surnaturel', 'supernatural'], ['thriller', 'thriller'], ['tranche de vie', 'slice of life']],
  };
  const COMMON_GENRES = [['seinen', 'seinen'], ['shojo', 'shojo'], ['shoujo', 'shojo'], ['shonen', 'shonen'], ['shounen', 'shonen'], ['thriller', 'thriller'], ['drama', 'drama']];

  // negation words before a genre/theme; the second list continues a negation chain
  const NEG = { es: ['sin', 'no', 'nada de', 'excepto', 'menos', 'ni'], en: ['without', 'no', 'not', 'excluding', 'nor', 'or'], it: ['senza', 'niente', 'non', 'ne'], de: ['ohne', 'keine', 'kein', 'keinen', 'nicht', 'noch', 'oder'], fr: ['sans', 'pas de', 'ni', 'ou'] };
  const CHAIN = new Set(['ni', 'nor', 'or', 'ne', 'noch', 'oder', 'ou']);

  const variants = (w) => {
    const out = [w];
    if (/[aeo]$/.test(w)) out.push(w + 's');
    if (/o$/.test(w)) out.push(w.slice(0, -1) + 'a', w.slice(0, -1) + 'as', w.slice(0, -1) + 'i', w.slice(0, -1) + 'e');
    if (/[^aeious]$/.test(w) && !w.includes(' ')) out.push(w + 'es');
    return out;
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Languages understood right now: Spanish, English and the UI language.
  function active() {
    const ui = (CRP.i18n ? CRP.i18n.current() : 'es').split('-')[0];
    return [...new Set(['es', 'en', ui])].filter((l) => STOP_WORDS[l]);
  }

  const cache = new Map();
  function vocab() {
    const langs = active();
    const key = langs.join(',');
    if (cache.has(key)) return cache.get(key);
    const genreMap = new Map();
    for (const l of langs) for (const [a, id] of [...GENRE_ALIASES[l], ...COMMON_GENRES]) for (const v of variants(a)) if (!genreMap.has(v)) genreMap.set(v, id);
    const genreAlt = [...genreMap.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
    const negAlt = [...new Set(langs.flatMap((l) => NEG[l]))].sort((a, b) => b.length - a.length).map(esc).join('|');
    const stop = new Set(langs.flatMap((l) => STOP_WORDS[l].split(' ')));
    const v = { genreMap, genreAlt, negAlt, stop, langs };
    cache.set(key, v);
    return v;
  }

  // --------------------------------------------------------------- rules
  function rules(opts) {
    const year = new Date().getFullYear();
    const dub = opts.dub || 'es-ES';
    const spanish = dub === 'es-419' ? 'es-419' : 'es-ES';
    const cur = opts.currentSeason;
    const langs = active();
    const r = [];
    const add = (re, apply, label, extra = {}) => r.push({ re, apply, label, ...extra });
    const rx = (src) => new RegExp(src, 'g');
    const words = (...alts) => `\\b(?:${alts.filter(Boolean).join('|')})\\b`;

    // "like X" in every active language — resolved against the catalog by the caller
    const LIKE = { es: 'como|parecid[ao]s? a|similar(?:es)? a|tipo|al estilo de|estilo|rollo', en: 'like|similar to|in the style of', it: 'come|simile a|tipo|stile', de: 'wie|ahnlich wie|im stil von', fr: 'comme|similaire a|dans le style de|genre' };
    r.push({ re: rx(`\\b(?:${langs.map((l) => LIKE[l]).join('|')})\\s+([^,;]+)`), like: true });

    // Lexicon per language: [concept, regex alternation]
    const L = {
      es: {
        unseen: 'sin ver|no vistas?|que no he visto|nuevas para mi|por descubrir', watchlist: 'en mi lista|de mi lista|mi lista',
        progress: 'a medias|empezadas?|en curso|que estoy viendo', seen: 'ya vistas?|que he visto',
        noMature: 'sin (?:contenido )?(?:adulto|\\+18|gore)|para (?:todos|ninos|todas las edades)|familiar(?:es)?|aptas? para todos',
        veryGood: 'muy buenas?|las mejores|obras? maestras?|imprescindibles?', good: 'buenas?|bien valoradas?|mejores|valoradas?',
        recent: 'recientes?|nuevas?|novedades|actuales?|modernas?|ultimas?', classic: 'clasic[ao]s?|antigu[ao]s?|viej[ao]s?|retro',
        veryShort: 'muy cortas?|cortitas?|miniseries?|mini series?', short: 'cort[ao]s?|breves?|de una temporada|rapidas? de ver',
        veryLong: 'muy largas?|eternas?|interminables?|maraton(?:es)?', long: 'larg[ao]s?', movie: 'peli|pelis|peliculas?',
        season: 'esta temporada|temporada actual|de la temporada|de este trimestre',
        airing: 'en emision|emitiendose|en directo|simulcasts?|semanal(?:es)?|saliendo', finished: 'terminad[ao]s?|acabad[ao]s?|complet[ao]s?|finalizad[ao]s?',
        gems: 'joyas?(?: ocultas?)?|desconocidas?|poco conocidas?|infravaloradas?', popular: 'populares?|famosas?|conocidas?|mas vistas?|de moda',
        noFiller: 'sin relleno|nada de relleno|cero relleno', lowFiller: 'poco relleno|casi sin relleno',
        dubbed: 'doblad[ao]s?|doblaje', ep: 'ep|eps|episodios?|caps?|capitulos?', rating: 'nota|puntuacion|valoracion|estrellas?',
        less: 'menos de|como mucho|maximo|max|hasta', more: 'mas de|minimo|min|al menos', since: 'desde|despues de|a partir de|posteriores? a',
        until: 'antes de|hasta|anteriores? a', between: 'desde|de|entre', to: 'a|al|hasta|y', decade: 'anos',
      },
      en: {
        unseen: "unwatched|not watched|haven'?t (?:seen|watched)|new to me|unseen", watchlist: 'in my (?:list|watchlist)|on my (?:list|watchlist)|my watchlist',
        progress: 'in progress|started|currently watching', seen: 'already (?:seen|watched)|watched before',
        noMature: 'family[- ]friendly|for kids|for everyone|no adult(?: content)?|no gore', veryGood: 'masterpieces?|must[- ]watch|the very best',
        good: 'good|well rated|highly rated|best|top rated', recent: 'recent|new|latest|modern', classic: 'classics?|old(?:ies)?|retro',
        veryShort: 'very short|mini ?series', short: 'short|quick|one season', veryLong: 'very long|endless|marathon', long: 'long',
        movie: 'movies?|films?', season: 'this season|current season', airing: 'airing|ongoing|simulcasts?|weekly', finished: 'finished|completed?|ended',
        gems: 'hidden gems?|gems?|underrated|lesser known', popular: 'popular|famous|trending', dubbed: 'dubbed|dub|dubs',
        noFiller: 'no filler|without filler|filler[- ]free|zero filler', lowFiller: 'little filler|low filler|barely any filler',
        ep: 'ep|eps|episodes?', rating: 'rating|score|stars?|rated', less: 'less than|under|at most|up to|max', more: 'more than|over|at least|min',
        since: 'since|from|after', until: 'before|until', between: 'from|between', to: 'to|and|until', decade: '',
      },
      it: {
        unseen: 'non vist[aeio]|da vedere|mai vist[aeio]', watchlist: 'nella mia lista|in lista|la mia lista', progress: 'iniziat[aeio]|in visione|a meta',
        seen: 'gia vist[aeio]', noMature: 'per tutti|per bambini|per famiglie|senza contenuti per adulti', veryGood: 'capolavor[oi]|imperdibil[ei]',
        good: 'buon[aeio]|ben valutat[aeio]|miglior[ei]', recent: 'recent[ei]|nuov[aeio]', classic: 'classic[aio]|classiche|vecch[io]|vecchie?|retro',
        veryShort: 'cortissim[aeio]|miniserie', short: 'cort[aeio]|brev[ei]', veryLong: 'lunghissim[aeio]|infinit[aeio]|maratona', long: 'lung(?:o|a|hi|he)',
        movie: 'film', season: 'questa stagione|stagione attuale', airing: 'in corso|in onda|settimanal[ei]', finished: 'conclus[aeio]|finit[aeio]|complet[aeio]',
        gems: 'gemme(?: nascoste)?|sottovalutat[aeio]|poco conosciut[aeio]', popular: 'popolar[ei]|famos[aeio]', dubbed: 'doppiat[aeio]|doppiaggio',
        noFiller: 'senza filler|niente filler', lowFiller: 'poco filler|pochi filler',
        ep: 'ep|episodi?|puntate?', rating: 'voto|valutazione|stelle', less: 'meno di|al massimo|fino a|max', more: 'piu di|almeno|min',
        since: 'dal|dopo il|dopo|a partire dal', until: 'prima del|fino al', between: 'dal|tra il|fra il', to: 'al|e|a', decade: 'anni',
      },
      de: {
        unseen: 'ungesehen|nicht gesehen|neu fur mich', watchlist: 'auf meiner liste|in meiner liste|merkliste|meine liste',
        progress: 'angefangen|begonnen|am schauen', seen: 'schon gesehen|bereits gesehen', noMature: 'familienfreundlich|fur kinder|fur alle|ohne erwachsenen ?inhalte?',
        veryGood: 'meisterwerke?|pflicht', good: 'gut(?:e|en|es|er)?|beste[nrs]?|top bewertet|gut bewertet', recent: 'neu(?:e|en|es|er)?|aktuell(?:e|en|es|er)?|neuste[nrs]?',
        classic: 'klassiker|alt(?:e|en|es)?|retro', veryShort: 'sehr kurz(?:e|en|es|er)?|miniserien?', short: 'kurz(?:e|en|es|er)?', veryLong: 'sehr lang(?:e|en|es|er)?|endlos|marathon',
        long: 'lang(?:e|en|es|er)?', movie: 'filme?', season: 'diese saison|aktuelle saison', airing: 'laufend(?:e|en|es|er)?|wochentlich|simulcasts?',
        finished: 'abgeschlossen(?:e|en|es|er)?|beendet(?:e|en|es|er)?|komplett', gems: 'geheimtipps?|versteckte perlen?|unterschatzt(?:e|en|es|er)?', popular: 'beliebt(?:e|en|es|er)?|bekannt(?:e|en|es|er)?',
        dubbed: 'synchronisiert(?:e|en|es|er)?|synchro|dub',
        noFiller: 'ohne filler|keine filler|fillerfrei', lowFiller: 'wenig filler|kaum filler', ep: 'ep|folgen?|episoden?', rating: 'bewertung|note|sterne', less: 'weniger als|hochstens|bis zu|max|unter',
        more: 'mehr als|mindestens|uber|min', since: 'seit|ab|nach', until: 'vor|bis', between: 'von|zwischen', to: 'bis|und', decade: '',
      },
      fr: {
        unseen: 'pas vu(?:e|es|s)?|non vu(?:e|es|s)?|jamais vu(?:e|es|s)?|a decouvrir', watchlist: 'dans ma liste|ma liste|ma watchlist', progress: 'commencees?|en cours de visionnage',
        seen: 'deja vu(?:e|es|s)?', noMature: 'pour tous|pour enfants|tout public|familiales?', veryGood: 'chefs?[- ]d.?oeuvre|incontournables?',
        good: 'bon(?:ne|nes|s)?|bien note(?:e|es|s)?|meilleur(?:e|es|s)?', recent: 'recent(?:e|es|s)?|nouve(?:au|aux|lle|lles)', classic: 'classiques?|ancien(?:ne|nes|s)?|vieux|vieilles?|retro',
        veryShort: 'tres court(?:e|es|s)?|mini[- ]?series?', short: 'court(?:e|es|s)?', veryLong: 'tres long(?:ue|ues|s)?|interminables?|marathon', long: 'long(?:ue|ues|s)?',
        movie: 'films?', season: 'cette saison|saison actuelle', airing: 'en cours|hebdomadaires?|simulcasts?', finished: 'termine(?:e|es|s)?|fini(?:e|es|s)?|complet(?:e|es|s)?|acheve(?:e|es|s)?',
        gems: 'pepites?|perles? rares?|sous[- ]estime(?:e|es|s)?|meconnu(?:e|es|s)?', popular: 'populaires?|connu(?:e|es|s)?|a la mode', dubbed: 'double(?:e|es|s)?|vf|version francaise',
        noFiller: 'sans filler|sans remplissage|zero filler', lowFiller: 'peu de filler|peu de remplissage',
        ep: 'ep|episodes?', rating: 'note|etoiles?', less: 'moins de|au plus|jusqu.a|max', more: 'plus de|au moins|min', since: 'depuis|apres|a partir de',
        until: 'avant|jusqu.en', between: 'de|entre', to: 'a|et', decade: 'annees',
      },
    };
    const any = (k) => langs.map((l) => L[l][k]).filter(Boolean).join('|');
    const EP = `(?:${any('ep')})`;

    add(rx(words(any('unseen'))), () => ({ mine: 'unseen' }), t('Sin ver'));
    add(rx(words(any('watchlist'))), () => ({ mine: 'watchlist' }), t('En mi lista'));
    add(rx(words(any('progress'))), () => ({ mine: 'progress' }), t('Empezadas'));
    add(rx(words(any('seen'))), () => ({ mine: 'seen' }), t('Ya vistas'));
    add(rx(words(any('noMature'))), () => ({ noMature: true }), t('Sin +18'));
    add(rx(words(any('noFiller'))), () => ({ fillerMax: 0 }), t('Sin relleno'));
    add(rx(words(any('lowFiller'))), () => ({ fillerMax: 0.1 }), t('Poco relleno (≤ 10 %)'));

    add(rx(`(?:${any('less')}|<=?)\\s*(\\d{1,4})\\s*${EP}\\b`), (m) => ({ epsMax: +m[1] }), (m) => '≤ ' + t('{n} ep', { n: m[1] }));
    add(rx(`(?:${any('more')}|>=?)\\s*(\\d{1,4})\\s*${EP}\\b`), (m) => ({ epsMin: +m[1] }), (m) => '≥ ' + t('{n} ep', { n: m[1] }));
    add(rx(`\\b(\\d{1,4})\\s*${EP}\\b`), (m) => ({ epsMin: Math.max(1, +m[1] - 2), epsMax: +m[1] + 2 }), (m) => '~' + t('{n} ep', { n: m[1] }));

    add(/\b(?:anilist|al)\s*(?:de\s*|>=?\s*|minim[oa]\s*)?(\d{2})\b/g, (m) => ({ alMin: +m[1] }), (m) => `AniList ≥ ${m[1]}`);
    add(/\b(?:mejor(?:es)? (?:en|segun) anilist|best on anilist|top anilist)\b/g, () => ({ alMin: 80 }), 'AniList ≥ 80', { sort: 'anilist' });
    const ratingOf = (m) => Math.min(5, parseFloat(m[1].replace(',', '.')));
    add(rx(`(?:${any('rating')})\\s*(?:de\\s*|minima\\s*|>=?\\s*|mayor (?:de|que)\\s*|of\\s*|above\\s*|di\\s*|von\\s*)?([1-5](?:[.,]\\d)?)`), (m) => ({ ratingMin: ratingOf(m) }), (m) => `★ ≥ ${ratingOf(m)}`);
    add(rx(`(?:>=?|${any('more')})\\s*([1-5][.,]\\d)\\b`), (m) => ({ ratingMin: ratingOf(m) }), (m) => `★ ≥ ${ratingOf(m)}`);
    add(rx(words(any('veryGood'))), () => ({ ratingMin: 4.7 }), '★ ≥ 4.7', { sort: 'rating' });
    add(rx(words(any('good'))), () => ({ ratingMin: 4.5 }), '★ ≥ 4.5', { sort: 'rating' });

    add(rx(`(?:\\b(?:${any('between')})\\s+)?\\b${YEAR}\\s*(?:-|${any('to')})\\s*${YEAR}\\b`), (m) => ({ yearMin: +m[1], yearMax: +m[2] }), (m) => `${m[1]}–${m[2]}`);
    add(rx(`\\b(?:${any('since')})\\s+(?:el\\s+|il\\s+)?${YEAR}\\b`), (m) => ({ yearMin: +m[1] }), (m) => t('desde {y}', { y: m[1] }));
    add(rx(`\\b(?:${any('until')})\\s+(?:el\\s+|il\\s+)?${YEAR}\\b`), (m) => ({ yearMax: +m[1] }), (m) => t('hasta {y}', { y: m[1] }));
    const dec = any('decade');
    add(rx(`\\b(?:(?:${dec || 'anos'})\\s+(?:19)?([5-9]0)|(?:19)?([5-9]0)(?:s|er|'s))\\b`), (m) => { const d = 1900 + +(m[1] || m[2]); return { yearMin: d, yearMax: d + 9 }; }, (m) => t('años {d}', { d: m[1] || m[2] }));
    add(rx(`\\b(?:(?:${dec || 'anos'})\\s+(20[0-2]0)|(20[0-2]0)(?:s|er))\\b`), (m) => { const d = +(m[1] || m[2]); return { yearMin: d, yearMax: d + 9 }; }, (m) => `${m[1] || m[2]}s`);
    add(rx(`\\b${YEAR}\\b`), (m) => ({ yearMin: +m[1], yearMax: +m[1] }), (m) => t('año {y}', { y: m[1] }));
    add(rx(words(any('recent'))), () => ({ yearMin: year - 2 }), t('desde {y}', { y: year - 2 }));
    add(rx(words(any('classic'))), () => ({ yearMax: 2009 }), t('Clásicas (≤ 2009)'));

    add(rx(words(any('veryShort'))), () => ({ epsMax: 12 }), '≤ ' + t('{n} ep', { n: 12 }));
    add(rx(words(any('short'))), () => ({ len: 'short' }), t('Corta (≤ 13 ep)'));
    add(rx(words(any('veryLong'))), () => ({ len: 'huge' }), t('Muy larga (75+ ep)'));
    add(rx(words(any('long'))), () => ({ len: 'long' }), t('Larga (27–75 ep)'));
    add(rx(words(any('movie'))), () => ({ len: 'movie' }), t('Película'));

    // Audio. Optional "con audio en" / "doblada al" lead-in so removing the chip removes it.
    const LEAD = '(?:(?:con )?(?:audio |doblaje |doblad[ao]s? )?(?:en |al ))?';
    const audio = (code) => t('Audio {lang}', { lang: CRP.util.langLower(code) });
    add(rx(`\\b${LEAD}(?:espanol latino|doblaje latino|latin[oa]s?|latam|latin american spanish|spagnolo latino|lateinamerikanisch|espagnol latino)\\b`), () => ({ audio: ['es-419'] }), audio('es-419'));
    add(rx(`\\b${LEAD}(?:espanol de espana|castellano|espanol|castilian|spanish|spagnolo|spanisch|espagnol)\\b`), () => ({ audio: [spanish] }), audio(spanish));
    add(rx(`\\b${LEAD}(?:ingles|english|in english|inglese|englisch|anglais|vo anglaise)\\b`), () => ({ audio: ['en-US'] }), audio('en-US'));
    if (langs.includes('it')) add(/\b(?:in italiano|italiano)\b/g, () => ({ audio: ['it-IT'] }), audio('it-IT'));
    if (langs.includes('de')) add(/\b(?:auf deutsch|deutsch)\b/g, () => ({ audio: ['de-DE'] }), audio('de-DE'));
    if (langs.includes('fr')) add(/\b(?:en francais|francais)\b/g, () => ({ audio: ['fr-FR'] }), audio('fr-FR'));
    add(rx(words(`${any('dubbed')}|dubbed|dub`)), () => ({ audio: [dub] }), t('Doblada ({lang})', { lang: CRP.util.langLower(dub) }));

    if (cur) add(rx(words(any('season'))), () => ({ season: cur.id }), cur.title);
    add(rx(words(any('airing'))), () => ({ status: 'airing' }), t('En emisión'));
    add(rx(words(any('finished'))), () => ({ status: 'finished' }), t('Terminada'));

    add(rx(words(any('gems'))), () => ({}), t('Joyas ocultas'), { sort: 'gems' });
    add(rx(words(any('popular'))), () => ({}), t('Populares'), { sort: 'popular' });
    return r;
  }

  // Source material in other languages (Spanish rules live in CRP.tags.SOURCE_RULES).
  const SOURCE_RULES_INTL = [
    [/\b(?:based on (?:a )?|from (?:a )?)light novels?\b|\b(?:tratto da (?:una )?)?light novel\b|\bnach (?:einer )?light novel\b|\b(?:adapte d.un(?:e)? )?light novel\b/g, 'LIGHT_NOVEL'],
    [/\b(?:based on (?:a )?|from (?:a )?)manga\b|\btratto da (?:un )?manga\b|\bnach (?:einem )?manga\b|\badapte d.un manga\b/g, 'MANGA'],
    [/\b(?:based on (?:a )?|from (?:a )?)(?:video ?game)\b|\btratto da (?:un )?videogioco\b|\bnach (?:einem )?videospiel\b|\badapte d.un jeu video\b/g, 'VIDEO_GAME'],
    [/\b(?:original (?:story|anime)|storia originale|originalgeschichte|histoire originale)\b/g, 'ORIGINAL'],
  ];

  /**
   * @returns {{ F: object, chips: Array<{label, start, end, kind}>, sort: string|null, like: string|null, rest: string }}
   */
  function parse(text, opts = {}) {
    const nt = norm(text);
    const V = vocab();
    const used = new Array(nt.length).fill(false);
    const free = (s, e) => { for (let i = s; i < e; i++) if (used[i]) return false; return true; };
    const take = (s, e) => { for (let i = s; i < e; i++) used[i] = true; };
    const F = { audio: [], genresIn: [], genresOut: [], tagsIn: [], tagsOut: [] };
    const chips = [];
    let sort = null;
    let like = null;

    for (const rule of rules(opts)) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(nt))) {
        const start = m.index;
        let end = start + m[0].length;
        if (!free(start, end)) continue;
        if (rule.like) {
          // longest prefix of the captured words that names a real title
          const words = m[1].trim().split(/\s+/);
          // "tipo shonen", "like short"… are filters, not titles
          if (V.genreMap.has(words[0]) || /^(cort|larg|castellan|latin|doblad|peli|terminad|buen|nota|joya|popular|short|long|dub)/.test(words[0])) continue;
          let hit = null;
          for (let n = words.length; n > 0 && !hit; n--) {
            const cand = words.slice(0, n).join(' ');
            const found = opts.findTitle && opts.findTitle(cand);
            if (found) { hit = found; end = start + m[0].indexOf(words[0]) + cand.length; }
          }
          if (!hit) continue;
          like = hit;
          take(start, end);
          chips.push({ label: t('Como {title}', { title: hit.title }), start, end, kind: 'like', fields: ['like'] });
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
    // Source material: "basado en novela ligera", "based on a manga", "tratto da un manga"…
    for (const [re, src] of [...T.SOURCE_RULES, ...SOURCE_RULES_INTL]) {
      re.lastIndex = 0;
      while ((m = re.exec(nt))) {
        const start = m.index;
        const end = start + m[0].length;
        if (!free(start, end)) continue;
        F.source = src;
        take(start, end);
        chips.push({ label: t('Origen: {x}', { x: T.sourceLabel(src) }), start, end, kind: 'filter', fields: ['source'] });
      }
    }
    // Studio: "de mappa", "by bones", "animata da kyoani"…
    const sre = T.studioRegex();
    if (sre) {
      sre.lastIndex = 0;
      while ((m = sre.exec(nt))) {
        const start = m.index;
        const end = start + m[0].length;
        if (!free(start, end)) continue;
        F.studio = T.studioName(m[1]);
        take(start, end);
        chips.push({ label: t('Estudio: {x}', { x: F.studio }), start, end, kind: 'filter', fields: ['studio'] });
      }
    }
    // Themes (AniList tags), with negation: "isekai sin harén", "no harem", "senza harem"
    const tre = T.themeRegex(V.negAlt);
    tre.lastIndex = 0;
    let lastNegT = -1;
    while ((m = tre.exec(nt))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const name = T.aliases.get(m[3]);
      if (!name) continue;
      const neg = !!(m[1] || m[2]) && (!CHAIN.has(m[1]) || lastNegT >= 0);
      if (neg) { lastNegT = end; F.tagsOut.push(name); } else { lastNegT = -1; F.tagsIn.push(name); }
      take(start, end);
      chips.push({ label: neg ? t('Sin {x}', { x: T.label(name) }) : T.label(name), start, end, kind: neg ? 'neg' : 'filter', fields: ['tags'], tag: name });
    }
    F.tagsIn = [...new Set(F.tagsIn)];
    F.tagsOut = [...new Set(F.tagsOut)].filter((x) => !F.tagsIn.includes(x));

    // Genres, with negation: "sin romance ni comedia", "no romance nor comedy", "-drama"
    const gre = new RegExp(`(?:\\b(${V.negAlt})\\s+|(-))?\\b(${V.genreAlt})\\b`, 'g');
    let lastNeg = -1;
    while ((m = gre.exec(nt))) {
      const start = m.index;
      const end = start + m[0].length;
      if (!free(start, end)) continue;
      const id = V.genreMap.get(m[3]);
      if (!id) continue;
      const neg = !!(m[1] || m[2]) && (!CHAIN.has(m[1]) || lastNeg >= 0);
      if (neg) { lastNeg = end; F.genresOut.push(id); } else { lastNeg = -1; F.genresIn.push(id); }
      take(start, end);
      chips.push({ label: neg ? t('Sin {x}', { x: M.genreTitle(id) }) : M.genreTitle(id), start, end, kind: neg ? 'neg' : 'filter', fields: ['genres'], genre: id });
    }
    F.genresIn = [...new Set(F.genresIn)];
    F.genresOut = [...new Set(F.genresOut)].filter((g) => !F.genresIn.includes(g));

    let rest = '';
    for (let i = 0; i < nt.length; i++) rest += used[i] ? ' ' : text[i];
    rest = rest.split(/[\s,;]+/).filter((w) => w && !V.stop.has(norm(w))).join(' ');
    chips.sort((a, b) => a.start - b.start);
    return { F, chips, sort, like, rest };
  }

  // Words for an audio language that the parser understands in the UI language, for
  // canned queries ("cortas en castellano…", "short spanish…"); else the generic "dubbed".
  const AUDIO_WORDS = {
    es: { 'es-ES': 'en castellano', 'es-419': 'en latino', 'en-US': 'en inglés' },
    en: { 'es-ES': 'spanish', 'es-419': 'latin american spanish', 'en-US': 'english' },
    it: { 'es-ES': 'spagnolo', 'es-419': 'spagnolo latino', 'en-US': 'inglese', 'it-IT': 'in italiano' },
    de: { 'es-ES': 'spanisch', 'es-419': 'lateinamerikanisch', 'en-US': 'englisch', 'de-DE': 'auf deutsch' },
    fr: { 'es-ES': 'espagnol', 'es-419': 'espagnol latino', 'en-US': 'anglais', 'fr-FR': 'en français' },
  };
  const DUBBED = { es: 'dobladas', en: 'dubbed', it: 'doppiate', de: 'synchronisiert', fr: 'doublées' };
  function audioWords(code) {
    const l = (CRP.i18n ? CRP.i18n.current() : 'es').split('-')[0];
    return (AUDIO_WORDS[l] && AUDIO_WORDS[l][code]) || DUBBED[l] || DUBBED.es;
  }

  // Remove a chip's words from the original text (spans refer to it).
  function removeSpan(text, chip) {
    return (text.slice(0, chip.start) + text.slice(chip.end)).replace(/\s*,\s*,/g, ',').replace(/\s+,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '').replace(/\s{2,}/g, ' ');
  }

  return { parse, removeSpan, esc, active, audioWords };
})();
