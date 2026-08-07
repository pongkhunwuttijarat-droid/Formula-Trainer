/**
 * Hash router — maps #/page[/param] to page render functions.
 */
(function (global) {
  'use strict';
  const FTUI = (global.FTUI = global.FTUI || {});

  const routes = new Map(); // name -> render(root, params)
  let currentCleanup = null;

  function register(name, render) {
    routes.set(name, render);
  }

  function parse() {
    const h = location.hash.replace(/^#\/?/, ''); // 'play' or 'play/trig-basics'
    const [name, ...rest] = h.split('/');
    return { name: name || 'home', params: rest };
  }

  function navigate(name, ...params) {
    const target = '#/' + [name, ...params].filter(Boolean).join('/');
    if (location.hash === target) {
      render(); // same-route navigation (e.g. starting a game from the play setup)
    } else {
      location.hash = target;
    }
  }

  function render() {
    const { name, params } = parse();
    const root = document.getElementById('app');
    const renderer = routes.get(name) || routes.get('home');
    if (currentCleanup) { try { currentCleanup(); } catch (e) { console.error(e); } currentCleanup = null; }
    FTUI.clear(root);
    if (renderer) currentCleanup = renderer(root, params) || null;
    // nav active state
    document.querySelectorAll('.main-nav a').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === name);
    });
    document.getElementById('session-indicator')?.replaceChildren();
    const ind = FTUI.sessionIndicator ? FTUI.sessionIndicator() : null;
    if (ind) document.getElementById('session-indicator')?.append(ind);
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function start() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/home';
    render();
  }

  FTUI.router = { register, navigate, render, start, parse };
})(window);
