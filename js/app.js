/**
 * App boot — wire storage to localStorage, seed sample packs on first run,
 * register routes, start the hash router.
 */
(function () {
  'use strict';

  // storage adapter: browser localStorage (engine stays adapter-agnostic)
  FTEngine.storage.setAdapter(window.localStorage);

  // seed bundled sample packs on first run (only when the user has zero packs)
  function seedIfEmpty() {
    if (!window.FT_SAMPLE_PACKS) return;
    const installed = FTEngine.storage.listPacks();
    if (installed.length === 0) {
      for (const pack of window.FT_SAMPLE_PACKS) {
        const v = FTEngine.validatePack(pack);
        if (!v.ok) { console.error('sample pack invalid:', v.errors); continue; }
        FTEngine.storage.savePack(FTEngine.normalizePack(pack));
      }
      return;
    }
    // upgrade bundled sample packs when their version changed
    for (const pack of window.FT_SAMPLE_PACKS) {
      const v = FTEngine.validatePack(pack);
      if (!v.ok) continue;
      const cur = installed.find((p) => p.metadata.id === pack.metadata.id);
      if (cur && cur.metadata.version !== pack.metadata.version) {
        FTEngine.storage.savePack(FTEngine.normalizePack(pack));
        console.log('upgraded sample pack', pack.metadata.id, cur.metadata.version, '->', pack.metadata.version);
      }
    }
  }
  seedIfEmpty();

  // routes
  FTUI.router.register('home', FTUI.homePage);
  FTUI.router.register('play', (root) => {
    // game view when a session exists & is running; otherwise setup
    const restored = FTEngine.session.restoreActiveSession();
    if (restored && FTUI.playGame) {
      return FTUI.playGame(root);
    }
    FTUI.playSetup(root);
  });
  FTUI.router.register('packs', FTUI.packsPage);
  FTUI.router.register('stats', FTUI.statsPage);
  FTUI.router.register('builder', FTUI.builderPage);

  FTUI.router.start();
})();
