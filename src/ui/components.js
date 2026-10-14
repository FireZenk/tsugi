// Reusable UI building blocks (plain DOM, rendered inside CR+'s shadow root).
var CRP = globalThis.CRP || (globalThis.CRP = {});

CRP.ui = (() => {
  const { h, svg, minutes, clamp } = CRP.util;
  const M = CRP.model;

  const ICONS = {
    plus: 'M12 5v14M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    play: 'M8 5.5v13l10.5-6.5z',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
    down: 'M6 9l6 6 6-6',
    up: 'M6 15l6-6 6 6',
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
    gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    refresh: ['M20 11a8 8 0 0 0-14.8-4M4 4v4h4', 'M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    thumbUp: ['M7 11v9H4v-9z', 'M7 11l4-7a2 2 0 0 1 3 1.7V9h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7'],
    thumbDown: ['M17 13V4h3v9z', 'M17 13l-4 7a2 2 0 0 1-3-1.7V15H5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.2 4H17'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4M16 3v4'],
    sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
    home: ['M4 11l8-7 8 7', 'M6 10v10h12V10'],
    back: 'M19 12H5M11 6l-6 6 6 6',
    info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v6M12 7.5v.5'],
    chart: ['M5 20V11', 'M10 20V5', 'M15 20v-7', 'M20 20V9', 'M3 20h18'],
  };

  function icon(name, size = 18) {
    const s = svg(ICONS[name], size);
    s.setAttribute('class', `i i-${name}`);
    return s;
  }

  function img(src, alt, cls) {
    return src
      ? h('img' + (cls ? '.' + cls : ''), { src, alt: alt || '', loading: 'lazy', decoding: 'async', draggable: 'false' })
      : h('div.noimg' + (cls ? '.' + cls : ''), alt ? alt.slice(0, 1) : '');
  }

  const fmtVotes = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

  function ratingEl(s, { votes = false } = {}) {
    if (s.rating == null) return null;
    return h('span.rating', { title: t('{r} de media · {n} votos', { r: s.rating, n: CRP.util.fmtNum(s.votes) }) },
      icon('star', 12), s.rating.toFixed(1), votes ? h('small', ` (${fmtVotes(s.votes)})`) : null);
  }

  // AniList community score pill (0–100), colored by band.
  function alEl(s) {
    const e = CRP.ext && CRP.ext.get(s.id);
    if (!e || e.s == null) return null;
    const band = e.s >= 85 ? '.top' : e.s >= 75 ? '.good' : e.s < 65 ? '.low' : '';
    return h('span.al' + band, { title: `AniList: ${e.s}/100 · ${t('{n} usuarios', { n: fmtVotes(e.u) })}${e.c === 'title' ? ' · ' + t('emparejado por título') : ''}` }, e.s);
  }

  function metaLine(s) {
    const bits = [];
    if (s.kind === 'movie_listing') bits.push(t('Película'));
    else if (s.episodes) bits.push(t('{n} ep', { n: s.episodes }));
    if (s.year) bits.push(s.year);
    return h('div.meta', ratingEl(s), alEl(s), bits.length ? h('span', bits.join(' · ')) : null);
  }

  // Plain clicks open the quick view; modified clicks keep normal link behaviour.
  const opensDrawer = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  // Poster card for a series / movie. actions: subset of ['list', 'like', 'dislike']
  function posterCard(s, { ctx, badge, sub, why, actions = ['list'] } = {}) {
    const btn = (cls, title, iconName, fn) => h('button.act.' + cls, {
      title,
      dataset: { sid: s.id },
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); fn(e); },
    }, icon(iconName, 16));
    const acts = [];
    if (ctx && ctx.loggedIn && actions.includes('list')) {
      const on = ctx.inWatchlist(s.id);
      acts.push(btn('list' + (on ? '.on' : ''), on ? t('Quitar de Mi lista') : t('Añadir a Mi lista'), on ? 'check' : 'plus', () => ctx.toggleWatchlist(s)));
    }
    if (ctx && actions.includes('like')) acts.push(btn('like' + (CRP.store.isLiked(s.id) ? '.on' : ''), t('Me gusta: recomiéndame más así'), 'thumbUp', () => ctx.like(s)));
    if (ctx && actions.includes('dislike')) acts.push(btn('dislike', t('No me interesa'), 'thumbDown', () => ctx.dislike(s)));

    return h('a.card.poster', {
      href: M.seriesUrl(s), dataset: { sid: s.id }, title: s.title,
      onclick: (e) => { if (ctx && opensDrawer(e)) { e.preventDefault(); ctx.openSeries(s); } },
    },
      h('div.art',
        img(s.poster, s.title),
        badge ? h('span.badge', badge) : null,
        h('div.hover',
          s.description ? h('p.desc', s.description) : null,
          h('div.genres', s.genres.slice(0, 3).map((g) => h('span', M.genreTitle(g)))),
        ),
        acts.length ? h('div.acts', acts) : null,
      ),
      h('div.title', s.title),
      metaLine(s),
      sub ? h('div.sub', sub) : null,
      why ? h('div.why', why) : null,
    );
  }

  // Wide card for an episode (links straight to the player).
  // acts: [{ icon, title, run, cls }] small round buttons on hover (e.g. mark as watched)
  function episodeCard(e, { progress = 0, badge, sub, extra, acts = [] } = {}) {
    const left = progress > 0 && e.durationMs ? minutes(e.durationMs * (1 - progress)) : null;
    const buttons = acts.map((a) => h('button.act' + (a.cls ? '.' + a.cls : ''), {
      title: a.title,
      onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); a.run(ev); },
    }, icon(a.icon, 16)));
    return h('a.card.ep', { href: M.episodeUrl(e), dataset: { sid: e.seriesId, eid: e.id }, title: `${e.seriesTitle || ''} — ${e.title}` },
      h('div.art',
        img(e.thumb, e.title),
        h('span.playbtn', icon('play', 26)),
        badge ? h('span.badge', badge) : null,
        buttons.length ? h('div.acts', buttons) : null,
        progress > 0 ? h('div.progress', h('i', { style: { width: clamp(progress * 100, 3, 100) + '%' } })) : null,
      ),
      h('div.title', e.seriesTitle || e.title),
      h('div.meta', h('span', [M.epLabel(e), e.kind !== 'movie' ? e.title : null].filter(Boolean).join(' — '))),
      sub || left ? h('div.sub', sub || t('Quedan {n} min', { n: left })) : null,
      extra || null,
    );
  }

  // Horizontal scroller with arrow buttons.
  function row(cards, { kind = 'poster' } = {}) {
    const track = h('div.track', cards);
    const scrollBy = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: 'smooth' });
    const prev = h('button.arrow.prev', { title: t('Anterior'), onclick: () => scrollBy(-1) }, icon('left', 22));
    const next = h('button.arrow.next', { title: t('Siguiente'), onclick: () => scrollBy(1) }, icon('right', 22));
    const update = () => {
      prev.hidden = track.scrollLeft < 8;
      next.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    };
    track.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
    new ResizeObserver(update).observe(track);
    return h('div.row.' + kind, prev, track, next);
  }

  // Grid, optionally capped at `limit` cards with a "show more" button.
  function grid(cards, { kind = 'poster', limit = 0 } = {}) {
    const el = h('div.grid.' + kind, limit && cards.length > limit ? cards.slice(0, limit) : cards);
    if (!limit || cards.length <= limit) return el;
    const more = h('button.btn.more', {
      onclick: () => { el.replaceChildren(...cards); more.remove(); },
    }, t('Mostrar {n} más', { n: cards.length - limit }));
    return h('div', el, more);
  }

  // Grid that renders `items` page by page as the user scrolls (hundreds of results).
  function lazyGrid(items, render, { page = 48, kind = 'poster', root = null } = {}) {
    const el = h('div.grid.' + kind);
    const sentinel = h('div.sentinel');
    let shown = 0;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { root, rootMargin: '900px' });
    function more() {
      el.append(...items.slice(shown, shown + page).map(render));
      shown += page;
      if (shown >= items.length) { io.disconnect(); sentinel.remove(); }
    }
    more();
    if (shown < items.length) requestAnimationFrame(() => io.observe(sentinel));
    return h('div', el, sentinel);
  }

  function skeleton(kind = 'poster', n = 8, { layout = 'row' } = {}) {
    const cards = Array.from({ length: n }, () => h('div.card.skel.' + kind, h('div.art'), h('div.l1'), h('div.l2')));
    return h(`div.${layout}.${kind}.loading`, layout === 'row' ? h('div.track', cards) : cards);
  }

  function empty(msg, action) {
    return h('div.empty', h('p', msg), action || null);
  }

  function errorBox(err, retry) {
    if (CRP.diag) CRP.diag.error('vista', err);
    const msg = err && err.status === 401 ? t('Inicia sesión en Crunchyroll para ver esto.') : t('No se pudo cargar. Crunchyroll no respondió como esperábamos.');
    // without the original page (data saver), offer to load it
    const saver = CRP.api && CRP.api.isPageless() ? h('button.btn.ghost', { onclick: () => CRP.saver.fail('manual') }, t('Cargar sin ahorro de datos')) : null;
    return h('div.empty.err', h('p', msg), h('div.btns.row', retry ? h('button.btn', { onclick: retry }, icon('refresh', 16), t('Reintentar')) : null, saver));
  }

  function progressBar(p, label) {
    const bar = h('i', { style: { width: clamp(p * 100, 2, 100) + '%' } });
    const text = h('span', label || '');
    const el = h('div.pbar', h('div.ptrack', bar), text);
    el.set = (v, l) => { bar.style.width = clamp(v * 100, 2, 100) + '%'; if (l != null) text.textContent = l; };
    return el;
  }

  // Chip group. multi=false behaves like tabs (one active).
  function chips(options, { value, multi = false, onChange }) {
    let sel = multi ? new Set(value || []) : value;
    const wrap = h('div.chips', { role: multi ? 'group' : 'tablist' });
    const render = () => {
      wrap.replaceChildren(...options.map((o) => {
        const active = multi ? sel.has(o.id) : sel === o.id;
        return h('button.chip' + (active ? '.on' : '') + (o.count === 0 && !active ? '.dim' : ''), {
          role: multi ? 'checkbox' : 'tab',
          'aria-checked': multi ? String(active) : null,
          'aria-selected': multi ? null : String(active),
          onclick: () => {
            if (multi) { sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id); onChange([...sel]); }
            else { sel = o.id; onChange(sel); }
            render();
          },
        }, o.title, o.count != null ? h('small', o.count) : null);
      }));
    };
    render();
    wrap.set = (v) => { sel = multi ? new Set(v || []) : v; render(); };
    return wrap;
  }

  function select(options, value, onChange, label) {
    const el = h('select.sel', { 'aria-label': label || '', onchange: () => onChange(el.value) },
      options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.title)));
    return el;
  }

  function toggle(label, checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!checked, onchange: () => onChange(input.checked) });
    return h('label.toggle', input, h('span.knob'), h('span.lbl', label));
  }

  // Bipolar slider: left label ← value → right label. Double-click recenters.
  function slider({ left, right, value, min = -1, max = 1, step = 0.1, onInput }) {
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': `${left} – ${right}` });
    input.value = String(value);
    input.addEventListener('input', () => onInput(parseFloat(input.value)));
    input.addEventListener('dblclick', () => { input.value = String(min < 0 ? 0 : min); onInput(parseFloat(input.value)); });
    return h('label.slider', h('span.l', left), input, h('span.r', right));
  }

  // Segmented control (one of N)
  function segmented(options, value, onChange) {
    const el = h('div.seg', { role: 'radiogroup' });
    const render = () => el.replaceChildren(...options.map((o) => h('button' + (o.id === value ? '.on' : ''), {
      role: 'radio', 'aria-checked': String(o.id === value),
      onclick: () => { value = o.id; render(); onChange(o.id); },
    }, o.icon ? icon(o.icon, 16) : null, h('span', o.title), o.sub ? h('small', o.sub) : null)));
    render();
    return el;
  }

  let toastHost = null;
  function setToastHost(el) { toastHost = el; }
  function toast(msg, { action, ms = 4000 } = {}) {
    if (!toastHost) return;
    const el = h('div.toast', h('span', msg), action ? h('button', { onclick: () => { action.run(); el.remove(); } }, action.label) : null);
    toastHost.append(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  // Titled block inside a view.
  function block({ title, subtitle, controls, cls }) {
    const body = h('div.bbody');
    const sub = h('span.subtitle', subtitle || '');
    const ctrl = h('div.controls', controls || null);
    const el = h('section.block' + (cls ? '.' + cls : ''), h('header.bhead', h('div.htext', h('h2', title), sub), ctrl), body);
    return {
      el, body,
      setBody: (...nodes) => body.replaceChildren(...nodes.flat().filter(Boolean)),
      setSubtitle: (s) => { sub.textContent = s || ''; },
      setControls: (...nodes) => ctrl.replaceChildren(...nodes.flat().filter(Boolean)),
    };
  }

  return {
    icon, img, fmtVotes, ratingEl, alEl, posterCard, episodeCard, row, grid, lazyGrid, skeleton, empty, errorBox, progressBar,
    chips, select, toggle, slider, segmented, toast, setToastHost, block,
  };
})();
