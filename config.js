// Konfigurasi runtime (tanpa folder). Aman untuk commit: anon key sifatnya PUBLIC.
// Cara isi:
// 1) Buka Supabase dashboard → Project Settings → API
// 2) Isi SUPABASE_URL dan SUPABASE_ANON_KEY sesuai project kamu
window.APP_CONFIG = {
  SUPABASE_URL: "https://lpdxddegvmhbnlnqzkmi.supabase.co",
  // TODO: tempel "anon public key" dari Supabase (bukan service_role!)
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwZHhkZGVndm1oYm5sbnF6a21pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1OTcwMDksImV4cCI6MjA5NjE3MzAwOX0.UuaNN8ZYqeSofq8lq6n_MucAXtiLNUcTlWqTD3x80Gs",
  // untuk magic-link redirect
  SITE_URL: window.location.origin,
};

