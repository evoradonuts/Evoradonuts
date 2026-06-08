// Vercel Serverless Function
// Simpan sebagai: /api/delete-user.js
//
// Fungsi: Owner bisa menghapus akun WORKER / INVESTOR (bukan owner) langsung dari aplikasi.
// Aman: validasi token owner + cek role owner di tabel profiles + cek role target bukan owner.

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    if (!SUPABASE_URL || !ANON || !SERVICE) {
      return res.status(500).json({ error: "Env di Vercel belum lengkap (SUPABASE_URL/ANON/SERVICE)." });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
    if (!token) return res.status(401).json({ error: "Butuh Authorization Bearer token (owner harus login)." });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const target_user_id = body?.target_user_id;
    const target_email = body?.target_email || null;

    if (!target_user_id) return res.status(400).json({ error: "target_user_id wajib." });

    // 1) Validasi token owner -> ambil user id
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    const userJson = await userResp.json();
    if (!userResp.ok) return res.status(401).json({ error: userJson?.msg || userJson?.error || "Token owner tidak valid." });
    const ownerId = userJson?.id;
    if (!ownerId) return res.status(401).json({ error: "Tidak bisa membaca owner id." });

    // 2) Cek role owner dari tabel profiles (pakai service role)
    const profResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=role&user_id=eq.${ownerId}&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    );
    const profJson = await profResp.json();
    const ownerRole = Array.isArray(profJson) && profJson[0]?.role;
    if (ownerRole !== "owner") return res.status(403).json({ error: "Hanya owner yang boleh menghapus akun." });

    // 3) Cek role target supaya tidak bisa hapus owner
    const targetResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=role,email&user_id=eq.${target_user_id}&limit=1`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    );
    const targetJson = await targetResp.json();
    const targetRole = Array.isArray(targetJson) && targetJson[0]?.role;
    const targetEmailFromDb = Array.isArray(targetJson) ? targetJson[0]?.email : null;
    if (!targetRole) return res.status(404).json({ error: "Target user tidak ditemukan di profiles." });
    if (targetRole === "owner") return res.status(403).json({ error: "Akun owner tidak boleh dihapus dari aplikasi." });

    // 4) Hapus user dari auth (cara resmi)
    const delResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${target_user_id}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
      },
    });
    if (!delResp.ok) {
      const t = await delResp.text();
      return res.status(400).json({ error: `Gagal hapus user auth: ${t}` });
    }

    // 5) Bersihkan invites jika email diketahui (opsional)
    const finalEmail = target_email || targetEmailFromDb;
    if (finalEmail) {
      await fetch(`${SUPABASE_URL}/rest/v1/invites?email=eq.${encodeURIComponent(finalEmail)}`, {
        method: "DELETE",
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
      }).catch(() => {});
    }

    return res.json({ ok: true, userId: target_user_id });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
};

