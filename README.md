# Crunchyroll+

Extensión de Chrome (Manifest V3) que convierte la página de inicio de
[crunchyroll.com](https://www.crunchyroll.com/) en una **herramienta para decidir qué
ver**, en lugar de una estantería de carruseles. Solo cambia el inicio (`/discover` con
sesión, `/` sin ella, con o sin prefijo de idioma como `/es-es/`);
series, reproductor e historial siguen siendo los de Crunchyroll.

## Cuatro modos + ficha rápida

**Hoy**
- *¿Qué veo ahora?* según el tiempo que tengas:
  - **Un rato**: el siguiente episodio de lo que sigues, priorizando estrenos recientes.
  - **Una tarde**: series que puedes terminar esta noche (≤ 4 ep) o una película recomendada.
  - **Maratón**: una serie terminada, de 10 a 40 episodios, que encaja con tu gusto.
  - Siempre hay una propuesta principal, tres alternativas y el botón «Otra».
- Sigue viendo, mini-agenda de la semana y búsquedas rápidas de un clic (p. ej. «cortas
  en castellano, bien valoradas», «joyas ocultas que no has visto»).

**Buscar**: todo el catálogo (~1.600 títulos) indexado en local, filtrado al instante.
- Escribe como hablas: `corta, en castellano, como Frieren, sin romance, nota 4.5`. Cada
  parte reconocida se convierte en un chip que se puede quitar. Lo que no entiende se usa
  como texto, y si eso deja la búsqueda a cero, se ignora y te lo dice.
- Panel de filtros con recuento en cada opción:
  - para mí (sin ver / en mi lista / empezadas / vistas);
  - audio (castellano y latino por separado);
  - duración por número de episodios, nota mínima, año;
  - en emisión / terminada, temporada;
  - géneros a incluir **o excluir**;
  - sin +18.
- Orden por relevancia, mejor valoradas (con la nota ajustada por número de votos),
  **joyas ocultas**, populares, último episodio, más nuevas, más cortas o A–Z.

**Para ti**: recomendaciones que **controlas** y que explican por qué aparecen.
- Mandos que reordenan al momento:
  - joyas ocultas ↔ populares;
  - cortas ↔ largas;
  - clásicas ↔ recientes;
  - lo de siempre ↔ descubrir;
  - «solo con audio en castellano».
- Tú decides de qué aprende: puedes desactivar series de tu historial que no
  representen tu gusto.
- 👍 la convierte en referencia («más como esta»). 👎 la quita y penaliza las que se le
  parecen.

**Agenda**
- Qué sale esta semana de lo que sigues, día y hora (estimada si aún no está publicada),
  y si ya lo viste.
- Pendientes por serie: episodios y horas para ponerte al día, calculados en el idioma de
  audio en el que la ves, con botón directo al siguiente episodio.
- Series abandonadas (más de 60 días con episodios pendientes), las que llevas al día y
  las de tu lista sin empezar.

**Ficha rápida** (clic en cualquier serie; Ctrl/⌘-clic abre la página normal):
- Desglose de notas y los idiomas de audio y subtítulos de la serie, más los doblajes que
  tiene **cada temporada**.
- Tu progreso y el botón «Empezar / Continuar TX · EY».
- Parecidas, por las que puedes ir saltando con «volver».

Ajustes (⚙): idioma de doblaje que te interesa, listas de 👍 y 👎, reindexar el catálogo,
recalcular, ver el inicio original o desactivar.

## Novedades 0.6

- **Seis idiomas**: castellano, español latino, inglés, italiano, alemán y francés.
  - Por defecto, el del prefijo de idioma de la web (`/es-es/`, `/es/`, `/it/`, `/de/`, `/fr/`; el resto, inglés). Se puede fijar en Ajustes → *Idioma de la interfaz*.
  - Traduce toda la interfaz, el popup y los avisos de estreno; fechas y días de la semana con el formato del idioma.
  - El buscador entiende castellano e inglés siempre, más el idioma de la interfaz: `kurz, synchronisiert, ohne Romantik`, `courte, en VF, sans harem`, `corta, doppiata, come Frieren`.
  - Las búsquedas de un clic, los planes de «¿Qué te apetece?» y los ejemplos están escritos en cada idioma (los tests comprueban que dan los mismos filtros que en castellano).
- **Ahorro de datos** (experimental, desactivado por defecto desde 0.6.4): en el inicio no se carga la página original de Crunchyroll, que queda oculta detrás de CR+ (~4 MB de scripts, imágenes y rastreadores), y CR+ renueva la sesión por su cuenta. Con algunas sesiones iniciadas dejaba la página en negro; si falla, se pausa solo y carga el original. Se activa en Ajustes.

## Novedades 0.5

- **Marcar como visto / quitar de "Sigue viendo"** desde las tarjetas de episodio, la propuesta de Hoy y la Agenda.
  - "Marcar como visto" se guarda en Crunchyroll y tiene deshacer.
  - "Quitar" solo oculta la entrada en CR+, hasta que haya un episodio más nuevo.
- **Orden de visionado** en la ficha: historia principal numerada y extras (películas, OVAs) colocados por fecha. Indica qué está en Crunchyroll y lleva a esa parte.
- **Tu cola**: ordena las series de tu lista que no has empezado; «¿Qué veo? → Maratón» empieza por arriba.
- **Limpiar Mi lista**: quita en bloque las terminadas o las abandonadas, con confirmación y deshacer.
- **Tus estrellas** en la ficha.
  - Opcionalmente se envían también a Crunchyroll.
  - Si ya habías valorado en Crunchyroll, se recupera.
  - Pesan en las recomendaciones ("Porque le diste 5★ a…").
- **¿Qué te apetece?** en Hoy: algo ligero, épico, para llorar, para pensar, misterio, romántico, relajante, tensión, otros mundos.
- **Atajos de teclado**: `/` buscar · `1–4` pestañas · `J/K` moverse · `Enter`/`F` ficha · `L` lista · `?` ayuda.
- **Tests**: `npm test` (node, sin dependencias).

## Novedades 0.4

- **Temas, estudio y origen** (de AniList).
  - Filtros "Temas" (isekai, viajes en el tiempo, protagonista femenina, relajante… incluir o excluir), "Estudio" y "Origen" (manga, novela ligera, original…).
  - El buscador los entiende: `isekai corto sin harén de mappa basado en novela ligera`.
- **Ficha más completa**: tráiler (YouTube sin cookies), temas, estudio, origen y hora del próximo episodio en Japón.
- **Importar tu perfil** de AniList o MyAnimeList (lista pública, solo nombre de usuario).
  - Lo que ya viste fuera de Crunchyroll queda marcado ("TU NOTA 9") y no te lo vuelve a recomendar.
  - Tus notas altas son la señal más fuerte del recomendador ("Porque le diste un 9 a…"); tus notas bajas y lo abandonado alejan lo parecido.
- **Estanterías propias** en Hoy. Cualquier búsqueda se guarda con «Guardar como estantería» y queda como fila fija. Se puede renombrar, reordenar y quitar.
- **Avisos de estreno**: notificación de Chrome cuando sale un episodio de lo que sigues, en tu idioma de audio, aunque no tengas Crunchyroll abierto.
  - El proceso en segundo plano consulta cada 15 min los episodios recién añadidos, con datos públicos y sin tus cookies.
  - Si Crunchyroll no responde desde ahí, usa el horario de emisión de AniList.
- **Diagnóstico** en Ajustes: estado de la sesión, prueba de cada servicio y botón para copiar un informe (con IDs enmascarados).

## Valoraciones externas

Las estrellas de Crunchyroll están muy comprimidas: casi todo saca entre 4,6 y 4,9.
Por eso CR+ añade la nota de la comunidad de **AniList** (0–100 y nº de usuarios), y en la
ficha también la de **MyAnimeList** (vía Jikan).

- **Emparejamiento**: las fichas de AniList enlazan a la serie de Crunchyroll, así que la
  mayoría casa por ID exacto, no por parecido de título. Si no hay enlace, prueba con el
  título y el año, y lo indica.
  - Probado con 120 series reales: 40/40 de las más populares, 40/40 de la zona media y
    33/40 de la cola (lo que falla son programas que no son anime: reseñas, radio…).
- **Temporadas**: las series con varias temporadas en AniList reciben la media ponderada
  por popularidad.
- **Uso**: la nota AniList aparece en las tarjetas (píldora «AL 86»). También es faceta
  de búsqueda («anilist 85» funciona en el buscador) y criterio de orden. Además, la
  calidad combinada (Crunchyroll + AniList) se usa en «Mejor valoradas», «Joyas
  ocultas» y en las recomendaciones.
- **Carga**: la primera vez consulta el catálogo entero en segundo plano (~3–4 min;
  AniList permite 30 peticiones/min, con 20 series por petición). Después se cachea 30
  días y solo consulta lo nuevo.
- **Privacidad**: solo se envían títulos de series, nada de tu cuenta. Se puede
  desactivar en Ajustes.

## Instalar (modo desarrollador)

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. **Cargar descomprimida** → elige esta carpeta.
3. Abre https://www.crunchyroll.com/ con tu sesión iniciada. La primera vez indexa el
   catálogo (~10–20 s); después es instantáneo y se refresca cada 24 h.

Tras cambiar código: botón ↻ de la extensión en `chrome://extensions` y recarga la pestaña.

## Cómo funciona

| Pieza | Qué hace |
| --- | --- |
| `src/hook.js` | Mundo `MAIN`: reutiliza el token que pide la propia web (`/auth/v1/token`), así usa tu cuenta y perfil sin pedirte nada. |
| `src/core/api.js` | Cliente de la API web (`/content/v2/...`). Renueva el token igual que la web (`etp_rt_cookie`) y sin sesión usa uno anónimo. |
| `src/core/catalog.js` | Índice local del catálogo (browse por popularidad + etiquetas de temporada) y motor de filtros/recuentos/orden. |
| `src/core/external.js` | Notas de AniList (lotes GraphQL, 4 pases de búsqueda, emparejado por enlace a Crunchyroll) y MyAnimeList (Jikan); calidad combinada. |
| `src/core/tags.js` | Temas de AniList con etiqueta traducida y sinónimos, origen y estudios para el intérprete. |
| `src/core/finder.js` | Motor de búsqueda común (vista Buscar y estanterías). |
| `src/core/profile.js` | Importación de listas públicas de AniList / MyAnimeList. |
| `src/core/diag.js` | Errores recientes, pruebas de conexión e informe. |
| `src/bg.js` | Proceso en segundo plano: avisos de estreno y lectura de listas de MAL. |
| `src/core/query.js` | Intérprete de frases (castellano, inglés y el idioma de la interfaz) → filtros y chips. |
| `src/core/i18n.js`, `src/i18n/` | Traducciones: la clave es el texto en castellano (`t('Mi lista')`); un diccionario por idioma, `es-419` solo con lo que cambia. |
| `src/core/recs.js` | `prepare()`: semillas del historial + 👍, y `similar_to` de cada una (en caché 7 días). `rank()`: puntuación instantánea con los mandos, 👎, afinidad de género, nota bayesiana y diversidad. |
| `src/core/agenda.js` | Temporadas y episodios de lo que sigues → pendientes, horas, calendario semanal, abandonadas. |
| `src/ui/` | Shadow DOM con estilos vía `adoptedStyleSheets`; vistas en `src/ui/views/`; ficha en `drawer.js`. |

La API no es pública: si Crunchyroll la cambia, alguna parte puede mostrar
«No se pudo cargar». Desde Ajustes siempre puedes volver al inicio original.

## Desarrollo sin la extensión

`dev/` tiene un banco de pruebas que carga los scripts reales con `chrome.*` y la API
simulados (catálogo sintético con temporadas, episodios semanales, idiomas y notas):

```bash
python3 dev/serve.py
```

Abre http://127.0.0.1:8777/dev/harness.html (añade `?anon` para simular que no hay sesión, `?site=en|es-419|it|de|fr` para otro idioma de la web).
