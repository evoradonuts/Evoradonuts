export default async function handler(req, res) {
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
    const { emailOrUsername, password, role, displayName = null, branchId = null, investorId = null } = body;

    const raw = String(emailOrUsername || "").trim();
    const pwd = String(password || "").trim();
    const finalRole = String(role || "").trim();

    if (!raw) return res.status(400).json({ error: "Username/Email wajib diisi." });
    if (!pwd || pwd.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
    if (!["worker", "investor"].includes(finalRole)) return res.status(400).json({ error: "Role harus worker/investor." });

    // samakan dengan app kamu
    const email = (raw.includes("@") ? raw : `${raw.toLowerCase()}@donatboss.local`).toLowerCase();

    if (finalRole === "worker" && !branchId) return res.status(400).json({ error: "Pilih cabang untuk worker." });
    if (finalRole === "investor" && !investorId) return res.status(400).json({ error: "Pilih investor untuk investor." });

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
    if (ownerRole !== "owner") return res.status(403).json({ error: "Hanya owner yang boleh membuat akun." });

    // 3) Insert invite (agar trigger handle_new_user isi profiles dengan benar)
    const inviteResp = await fetch(`${SUPABASE_URL}/rest/v1/invites`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        email,
        role: finalRole,
        displayName,
        branchId: finalRole === "worker" ? branchId : null,
        investorId: finalRole === "investor" ? investorId : null,
        created_by: ownerId,
      }),
    });
    if (!inviteResp.ok) {
      const t = await inviteResp.text();
      return res.status(400).json({ error: `Gagal simpan invite: ${t}` });
    }

    // 4) Buat user auth (cara resmi)
    const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: pwd,
        email_confirm: true,
      }),
    });
    const createJson = await createResp.json();
    if (!createResp.ok) return res.status(400).json({ error: createJson?.msg || createJson?.error || "Gagal membuat user." });

    return res.json({ ok: true, email, userId: createJson?.id || createJson?.user?.id || null });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
