# Respuestas para el panel de desarrollador (pestaña «Prácticas de privacidad»)

Copiar tal cual en el Chrome Web Store Developer Dashboard. En inglés, que es lo que lee el equipo de revisión.

## Single purpose

Tsugi replaces the Crunchyroll home page with a tool to decide what to watch next on Crunchyroll: full-catalog search with real filters, recommendations, a release calendar and backlog, filler information and viewing stats. Related helpers (release notifications, a spoiler-free mode on Crunchyroll episode lists) serve the same purpose.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, likes/dislikes, star ratings, shelves and queue, plus local caches (catalog index, AniList data). |
| `unlimitedStorage` | The local index of the whole Crunchyroll catalog and its metadata caches can exceed the default 10 MB quota. |
| `alarms` | Schedules the periodic (every 15 minutes) check for new episodes of the series the user follows. |
| `notifications` | Shows release notifications for new episodes of followed series. The user can turn them off in settings. |
| Host `https://www.crunchyroll.com/*` | Content scripts replace the home page and blur spoilers on episode lists; the extension calls Crunchyroll's own web API with the user's existing session; the background worker reads Crunchyroll's public "newly added" list (anonymously) for notifications. |
| Host `https://myanimelist.net/*` | Reads the user's public MyAnimeList list when they choose to import it (myanimelist.net does not allow cross-origin requests from the page). |

## Remote code

No, I am not using remote code. All JavaScript is packaged in the extension; no `eval`, no remotely loaded scripts.

## Data usage (checkboxes)

Marcar:
- **Authentication information** — the user's own Crunchyroll session is used locally to call Crunchyroll's API; the website's session-renewal parameters (not passwords) are stored locally. Never sent anywhere else.
- **User activity** — the user's Crunchyroll watch history is read to build recommendations, the calendar and stats, locally.

No marcar: personally identifiable information, health, financial, personal communications, location, web history (no browser history is read), website content (only Crunchyroll's own catalog, not user content).

Certificar las tres casillas:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** URL pública donde se publique `docs/privacy.html`.

## Notas para el revisor (campo opcional)

The extension only changes https://www.crunchyroll.com/ home routes (/, /discover and their language prefixes). To test signed-in features a Crunchyroll account is needed; without one the home shows the anonymous catalog search and recommendations from popularity. External services used: graphql.anilist.co and api.jikan.moe (public, no keys), myanimelist.net only on explicit list import.
