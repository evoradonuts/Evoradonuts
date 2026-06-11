// supabaseClient.js
// Inisialisasi Supabase client dari config yang sudah diisi di config.js
// File ini harus di-load SETELAH config.js dan SEBELUM app.bundle.js

(function () {
  var url  = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL;
  var key  = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY;

  if (!url || !key) {
    document.body.innerHTML =
      '<div style="font-family:sans-serif;padding:40px;color:#ef4444;">' +
      '<h2>Konfigurasi Belum Diisi</h2>' +
      '<p>Buka <strong>config.js</strong> dan isi <code>SUPABASE_URL</code> ' +
      'serta <code>SUPABASE_ANON_KEY</code> sesuai project Supabase kamu.</p>' +
      '</div>';
    return;
  }

  // supabase-js v2 UMD sudah di-load via CDN di index.html → window.supabase
  var client = window.supabase.createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: "implicit",
    },
  });

  // Expose global agar app.bundle.js bisa pakai window.sb
  window.sb = client;
})();
