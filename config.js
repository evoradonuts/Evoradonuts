// Konfigurasi runtime (tanpa folder). Aman untuk commit: anon key sifatnya PUBLIC.
// Cara isi:
// 1) Buka Supabase dashboard → Project Settings → API
// 2) Isi SUPABASE_URL dan SUPABASE_ANON_KEY sesuai project kamu
window.APP_CONFIG = {
  SUPABASE_URL: "https://emqunokxizlcruejuqjb.supabase.co",
  // TODO: tempel "anon public key" dari Supabase (bukan service_role!)
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtcXVub2t4aXpsY3J1ZWp1cWpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NjA5NTgsImV4cCI6MjA5NjIzNjk1OH0.4hlF4AO1vvl0b52p1O1Z8F-81Ivtp6qUdBKPfrB6aDg",
  // untuk magic-link redirect
  SITE_URL: window.location.origin,
};

