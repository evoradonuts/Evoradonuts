(() => {
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("PASTE_")) {
    console.warn(
      "[Evora] config.js belum diisi. Isi SUPABASE_URL dan SUPABASE_ANON_KEY dulu (anon/public key)."
    );
  }

  // Supabase UMD global: window.supabase
  const { createClient } = window.supabase;
  window.sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
