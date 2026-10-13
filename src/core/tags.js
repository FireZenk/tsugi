// Themes from AniList (tags + the genres Crunchyroll doesn't have) with Spanish labels
// and the words people actually type, plus source material and studio matching.
// Used by the query parser ("isekai sin harén de mappa basado en novela ligera"), the
// search facets and the quick view.
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.tags = (() => {
  const { norm } = CRP.util;

  // [AniList name, Spanish label, aliases (Spanish/English, unaccented)]
  const THEMES = [
    // AniList genres missing from Crunchyroll's categories
    ['Mystery', 'Misterio', ['misterio', 'misterios']],
    ['Horror', 'Terror', ['terror', 'horror', 'de miedo']],
    ['Psychological', 'Psicológico', ['psicologico', 'psicologica', 'psicologicos', 'psicologicas']],
    ['Mecha', 'Mecha', ['mecha', 'mechas']],
    ['Mahou Shoujo', 'Chicas mágicas', ['chicas magicas', 'chica magica', 'magical girl', 'mahou shoujo']],
    ['Ecchi', 'Ecchi', ['ecchi']],
    // tags
    ['Isekai', 'Isekai', ['isekai', 'otro mundo', 'transportado a otro mundo']],
    ['Reincarnation', 'Reencarnación', ['reencarnacion', 'reencarnado', 'reencarna']],
    ['Time Manipulation', 'Viajes en el tiempo', ['viajes en el tiempo', 'viaje en el tiempo', 'time travel']],
    ['Time Loop', 'Bucle temporal', ['bucle temporal', 'bucles temporales', 'time loop']],
    ['Female Protagonist', 'Protagonista femenina', ['protagonista femenina', 'prota femenina', 'protagonista chica', 'chica protagonista']],
    ['Male Protagonist', 'Protagonista masculino', ['protagonista masculino', 'prota masculino']],
    ['Female Harem', 'Harén', ['haren', 'harem']],
    ['Male Harem', 'Harén inverso', ['haren inverso', 'reverse harem', 'harem inverso']],
    ['Magic', 'Magia', ['magia', 'magos', 'hechiceria']],
    ['School', 'Instituto', ['instituto', 'escolar', 'escuela', 'colegio', 'school']],
    ['Super Power', 'Superpoderes', ['superpoderes', 'poderes']],
    ['Martial Arts', 'Artes marciales', ['artes marciales', 'kung fu']],
    ['Samurai', 'Samuráis', ['samurai', 'samurais']],
    ['Ninja', 'Ninjas', ['ninja', 'ninjas']],
    ['Pirates', 'Piratas', ['piratas', 'pirata']],
    ['Vampire', 'Vampiros', ['vampiros', 'vampiro', 'vampiras']],
    ['Zombie', 'Zombis', ['zombis', 'zombies', 'zombi', 'zombie']],
    ['Demons', 'Demonios', ['demonios', 'demonio']],
    ['Gods', 'Dioses', ['dioses', 'deidades']],
    ['Dragons', 'Dragones', ['dragones']],
    ['Aliens', 'Alienígenas', ['aliens', 'alienigenas', 'extraterrestres']],
    ['Robots', 'Robots', ['robots', 'robot']],
    ['Witch', 'Brujas', ['brujas', 'bruja']],
    ['Kaiju', 'Kaijus', ['kaiju', 'kaijus', 'monstruos gigantes']],
    ['Survival', 'Supervivencia', ['supervivencia', 'survival']],
    ['Post-Apocalyptic', 'Postapocalíptico', ['postapocaliptico', 'post apocaliptico', 'apocaliptico', 'apocalipsis']],
    ['Dystopian', 'Distopía', ['distopia', 'distopico', 'distopica']],
    ['Cyberpunk', 'Cyberpunk', ['cyberpunk']],
    ['Steampunk', 'Steampunk', ['steampunk']],
    ['Space', 'Espacio', ['espacio', 'espacial', 'naves espaciales']],
    ['Military', 'Militar', ['militar', 'ejercito']],
    ['War', 'Guerra', ['guerra', 'guerras', 'belico', 'belica']],
    ['Historical', 'Histórico', ['historico', 'historica', 'de epoca']],
    ['Revenge', 'Venganza', ['venganza']],
    ['Tragedy', 'Tragedia', ['tragedia', 'tragica', 'para llorar']],
    ['Gore', 'Gore', ['gore', 'sangrienta']],
    ['Iyashikei', 'Relajante', ['iyashikei', 'relajante', 'relajantes', 'tranquila', 'tranquilas']],
    ['Cute Girls Doing Cute Things', 'Chicas monas', ['chicas monas', 'cgdct', 'moe']],
    ['Food', 'Comida', ['cocina', 'comida', 'cocinar', 'gastronomia']],
    ['Video Games', 'Videojuegos', ['videojuegos', 'gamer', 'gamers']],
    ['Detective', 'Detectives', ['detective', 'detectives', 'investigacion']],
    ['Crime', 'Crimen', ['crimen', 'criminales', 'mafia', 'yakuza']],
    ['Anti-Hero', 'Antihéroe', ['antiheroe', 'anti heroe', 'antiheroes']],
    ['Villainess', 'Villana', ['villana', 'villanas']],
    ["Boys' Love", 'Boys love', ['yaoi', 'boys love']],
    ['Yuri', 'Yuri', ['yuri', 'girls love']],
    ['Coming of Age', 'Madurar', ['madurez', 'crecer', 'coming of age']],
    ['Found Family', 'Familia elegida', ['familia elegida', 'found family']],
    ['Band', 'Bandas', ['banda de musica', 'bandas', 'banda de rock']],
    ['Idol', 'Idols', ['idol', 'idols']],
    ['Workplace', 'Trabajo', ['trabajo', 'oficina', 'laboral']],
    ['Parody', 'Parodia', ['parodia', 'parodias']],
    ['Rural', 'Rural', ['rural', 'campo', 'pueblo']],
    ['Travel', 'Viajes', ['viajes', 'viajar', 'road trip']],
    ['Episodic', 'Episódica', ['episodica', 'episodico', 'autoconclusivos']],
    ['Ensemble Cast', 'Reparto coral', ['reparto coral', 'coral']],
    ['Love Triangle', 'Triángulo amoroso', ['triangulo amoroso']],
    ['Death Game', 'Juego mortal', ['juego mortal', 'juegos mortales', 'death game']],
    ['Battle Royale', 'Battle royale', ['battle royale']],
    ['Philosophy', 'Filosofía', ['filosofia', 'filosofica']],
    ['Dungeon', 'Mazmorras', ['mazmorras', 'mazmorra', 'dungeon']],
    ['Primarily Adult Cast', 'Protagonistas adultos', ['protagonistas adultos', 'personajes adultos']],
    ['Urban Fantasy', 'Fantasía urbana', ['fantasia urbana']],
    ['Card Battle', 'Juegos de cartas', ['juegos de cartas', 'cartas']],
    ['Baseball', 'Béisbol', ['beisbol', 'baseball']],
    ['Basketball', 'Baloncesto', ['baloncesto', 'basket']],
    ['Football', 'Fútbol', ['futbol', 'soccer']],
    ['Volleyball', 'Voleibol', ['voleibol']],
    ['Tennis', 'Tenis', ['tenis']],
    ['Boxing', 'Boxeo', ['boxeo']],
  ];

  const SOURCES = {
    MANGA: 'Manga', LIGHT_NOVEL: 'Novela ligera', ORIGINAL: 'Original', VISUAL_NOVEL: 'Novela visual',
    VIDEO_GAME: 'Videojuego', NOVEL: 'Novela', WEB_NOVEL: 'Novela web', GAME: 'Juego', COMIC: 'Cómic',
    DOUJINSHI: 'Doujinshi', ANIME: 'Anime', LIVE_ACTION: 'Imagen real', MULTIMEDIA_PROJECT: 'Proyecto multimedia',
    PICTURE_BOOK: 'Libro ilustrado', OTHER: 'Otro',
  };

  const labels = new Map(THEMES.map(([name, label]) => [name, label]));
  const label = (name) => labels.get(name) || name;
  const sourceLabel = (src) => SOURCES[src] || src;

  // normalized alias -> AniList name. Extra names seen in the data (English tags the
  // dictionary doesn't cover, like "Fugitive") are added as typed in English.
  const aliases = new Map();
  for (const [name, , al] of THEMES) {
    aliases.set(norm(name), name);
    for (const a of al) aliases.set(a, name);
  }
  let known = aliases.size;
  function addNames(names) {
    for (const n of names) if (!aliases.has(norm(n))) aliases.set(norm(n), n);
  }

  let themeRe = null;
  let themeReSize = 0;
  function themeRegex() {
    if (!themeRe || themeReSize !== aliases.size) {
      const alt = [...aliases.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      // optional negation like the genre rule: "sin harén", "ni gore", "-isekai"
      themeRe = new RegExp(`(?:\\b(sin|no|nada de|excepto|menos|ni)\\s+|(-))?\\b(${alt})\\b`, 'g');
      themeReSize = aliases.size;
    }
    return themeRe;
  }

  const SOURCE_RULES = [
    [/\b(?:basad[ao]s? en (?:un |una )?|adaptacion de |de )?novelas? ligeras?\b|\blight novels?\b/g, 'LIGHT_NOVEL'],
    [/\b(?:basad[ao]s? en (?:un |una )?|adaptacion de |de )?novelas? visual(?:es)?\b/g, 'VISUAL_NOVEL'],
    [/\b(?:basad[ao]s? en (?:un |una )?|adaptacion de |de )?novelas? web\b|\bweb novels?\b/g, 'WEB_NOVEL'],
    [/\b(?:basad[ao]s? en (?:un )?|adaptacion de (?:un )?|de )videojuegos?\b/g, 'VIDEO_GAME'],
    [/\b(?:basad[ao]s? en (?:un )?|adaptacion de (?:un )?|de )mangas?\b/g, 'MANGA'],
    [/\b(?:historias? originales?|guion original|anime original)\b/g, 'ORIGINAL'],
  ];

  // Studios seen in the data; "Studio Pierrot" also matches "pierrot".
  let studioRe = null;
  let studioMap = new Map();
  function setStudios(names) {
    const m = new Map();
    for (const n of names) {
      const k = norm(n);
      if (k.length < 3) continue;
      m.set(k, n);
      const short = k.replace(/^studio\s+|\s+studios?$/g, '');
      if (short.length >= 4 && !m.has(short)) m.set(short, n);
    }
    m.set('kyoani', 'Kyoto Animation');
    if (m.size === studioMap.size) return;
    studioMap = m;
    const alt = [...m.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    studioRe = alt ? new RegExp(`\\b(?:del estudio|estudio|studio|animad[ao]s? por|de)\\s+(${alt})\\b`, 'g') : null;
  }

  return {
    THEMES, SOURCES, label, sourceLabel, aliases, addNames, themeRegex, SOURCE_RULES,
    setStudios, studioRegex: () => studioRe, studioName: (k) => studioMap.get(k),
    knownCount: () => known,
  };
})();
