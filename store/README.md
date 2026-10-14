# Publicar Tsugi en la Chrome Web Store

Todo lo necesario está en este repositorio salvo lo marcado como **(tú)**.

## 1. Antes de subir
- [ ] **(tú)** Cuenta de desarrollador de la Chrome Web Store (pago único de 5 US$): https://chrome.google.com/webstore/devconsole
- [ ] **(tú)** Publicar `docs/privacy.html` en una URL pública (p. ej. GitHub Pages del repositorio, o cualquier hosting estático) y poner un correo de contacto donde dice `[correo de contacto]`.
- [ ] `npm test` en verde.
- [ ] `npm run package` → `dist/tsugi-<versión>.zip` (comprueba versiones, longitudes de la ficha y ficheros referenciados).

## 2. Subir el paquete
Developer Dashboard → *Add new item* → subir el zip de `dist/`.

## 3. Ficha (pestaña *Store listing*)
- Textos: `store/listing.md` (español por defecto; añadir las traducciones en *Localize your listing*: es_419, en, it, de, fr).
- Categoría: **Entertainment**.
- Icono: `icons/icon128.png`.
- Capturas 1280×800: `store/images/screenshot-es-*.png` (español) y `screenshot-en-*.png` (inglés y resto de idiomas).
- Imagen promocional pequeña 440×280: `store/images/promo-small-440x280-*.png`; marquesina 1400×560 (opcional): `promo-marquee-1400x560-*.png`.

## 4. Privacidad (pestaña *Privacy practices*)
Copiar de `store/review.md`: propósito único, justificación de cada permiso, «no remote code», datos usados y las tres certificaciones. URL de la política de privacidad del paso 1.

## 5. Distribución
- Visibilidad: pública (o *unlisted* para una primera prueba con enlace).
- Países: todos.
- Enviar a revisión. Suele tardar de unas horas a unos días; con permisos sobre un dominio concreto y sin código remoto no debería haber sorpresas.

## Nombre y marca
- Nombre: **Tsugi for Crunchyroll** (fórmula «… for <servicio>», sin aparentar ser oficial). El nombre se cambia en un solo sitio: `CRP.brand` en `src/core/i18n.js` (+ `manifest.json`).
- No se usa el logotipo ni los colores exactos de Crunchyroll; el icono es el kanji 次 («siguiente»).
- Las descripciones incluyen «no afiliado a Crunchyroll».
- Las capturas usan los datos sintéticos del harness (`dev/harness.html?site=es&shots`), sin carteles ni imágenes de terceros. Para regenerarlas: ver «Capturas» en el README.
