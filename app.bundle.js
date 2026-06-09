var DonatBoss = (() => {
  var { useState, useEffect, useCallback, useMemo } = React;
  var sb = window.sb;
  
  // Patch RPC bypass untuk penghapusan user langsung dari client-side admin
  try {
    const __rpc = sb.rpc.bind(sb);
    sb.rpc = async (fn, args) => {
      if (fn === "hapus_akun_langsung") {
        try {
          const { data: sessData } = await sb.auth.getSession();
          const token = sessData?.session?.access_token;
          if (!token) throw new Error("Owner harus login terlebih dahulu.");
          const resp = await fetch("/api/delete-user", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify(args || {})
          });
          const text = await resp.text();
          let json = null;
          try { json = JSON.parse(text); } catch (e) {}
          if (!resp.ok) throw new Error(json?.error || text || "Gagal menghapus akun.");
          return { data: json, error: null };
        } catch (e) {
          return { data: null, error: { message: e?.message || String(e) } };
        }
      }
      return __rpc(fn, args);
    };
  } catch (e) {}

  var uid = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  };

  // --- ENGINE STATE ENGINE SUPABASE (S) ---
  var S = (() => {
    const TABLE_BY_KEY = {
      branches: "branches",
      bahanPokok: "bahanPokok",
      menuVarian: "menuVarian",
      topingTambahan: "topingTambahan",
      investors: "investors",
      profiles: "profiles",
      transactions: "transactions",
      setoranHarian: "setoranHarian",
      setoranBulanan: "setoranBulanan",
      absensi: "absensi",
      absensiBulanan: "absensiBulanan",
      editLog: "editLog",
      pengeluaranLapak: "pengeluaranLapak",
      pengeluaranOwner: "pengeluaranOwner"
    };
    const LOCAL_KEYS = new Set(["notified_ids", "jadwalLibur"]);
    let cache = {};
    let channels = [];
    const listeners = new Set();
    let onError = (msg) => console.warn(msg);
    const emit = () => listeners.forEach((fn) => fn());
    const deepEq = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
    
    const get = (k, def = null) => {
      if (LOCAL_KEYS.has(k)) {
        try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
      }
      return k in cache ? cache[k] : def;
    };
    const setLocal = (k, v) => {
      if (LOCAL_KEYS.has(k)) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
        emit(); return;
      }
      cache[k] = v; emit();
    };
    const setErrorHandler = (fn) => { onError = typeof fn === "function" ? fn : onError; };
    const loadKey = async (key) => {
      const table = TABLE_BY_KEY[key]; if (!table) return;
      const { data, error } = await sb.from(table).select("*");
      if (error) throw error; cache[key] = data || [];
    };
    const loadAll = async () => {
      const keys = Object.keys(TABLE_BY_KEY).filter((k) => k !== "profiles");
      await Promise.all(keys.map((k) => loadKey(k))); emit();
    };
    const applyRealtime = (key, payload) => {
      const table = TABLE_BY_KEY[key]; if (!table) return;
      const ev = payload.eventType; const rowNew = payload.new; const rowOld = payload.old;
      const id = rowNew && rowNew.id || rowOld && rowOld.id; if (!id) return;
      const cur = cache[key] || [];
      if (ev === "DELETE") { cache[key] = cur.filter((x) => x.id !== id); emit(); return; }
      if (ev === "INSERT") { cache[key] = [...cur.filter((x) => x.id !== id), rowNew]; emit(); return; }
      if (ev === "UPDATE") { cache[key] = cur.map((x) => x.id === id ? rowNew : x); emit(); return; }
    };
    const startRealtime = () => {
      stopRealtime();
      Object.entries(TABLE_BY_KEY).forEach(([key, table]) => {
        if (LOCAL_KEYS.has(key)) return;
        const ch = sb.channel("rt:" + table).on("postgres_changes", { event: "*", schema: "public", table }, (payload) => applyRealtime(key, payload)).subscribe();
        channels.push(ch);
      });
    };
    const stopRealtime = () => { channels.forEach((ch) => { try { sb.removeChannel(ch); } catch (e) {} }); channels = []; };
    const persistDiff = async (key, beforeArr, afterArr) => {
      const table = TABLE_BY_KEY[key]; if (!table) return;
      const before = Array.isArray(beforeArr) ? beforeArr : []; const after = Array.isArray(afterArr) ? afterArr : [];
      const bMap = new Map(before.map((r) => [r.id, r])); const aMap = new Map(after.map((r) => [r.id, r]));
      const toInsert = []; const toUpdate = [];
      for (const [id, row] of aMap.entries()) {
        const prev = bMap.get(id); if (!prev) { toInsert.push(row); continue; }
        if (!deepEq(prev, row)) toUpdate.push(row);
      }
      const toDelete = []; for (const [id] of bMap.entries()) { if (!aMap.has(id)) toDelete.push(id); }
      if (toInsert.length) { const { error } = await sb.from(table).insert(toInsert); if (error) throw error; }
      if (toUpdate.length) {
        for (const row of toUpdate) { const { id, ...payload } = row; const { error } = await sb.from(table).update(payload).eq("id", id); if (error) throw error; }
      }
      if (toDelete.length) { const { error } = await sb.from(table).delete().in("id", toDelete); if (error) throw error; }
    };
    const set = (key, value) => {
      if (LOCAL_KEYS.has(key)) { setLocal(key, value); return; }
      const before = cache[key]; cache[key] = value; emit();
      persistDiff(key, before, value).catch((e) => onError(e?.message || String(e)));
    };
    const reset = () => { stopRealtime(); cache = {}; emit(); };
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    return { get, set, setLocal, loadAll, loadKey, startRealtime, stopRealtime, reset, subscribe, setErrorHandler };
  })();

  var fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  var today = () => { const d = new Date(); d.setHours(d.getHours() + 7); return d.toISOString().slice(0, 10); };
  var nowTs = () => new Date().toLocaleString("id-ID");
  var nowIso = () => new Date().toISOString();
  var fmtTs = (v) => { if (!v) return "-"; try { return new Date(v).toLocaleString("id-ID"); } catch (e) { return String(v); } };

  function useStoreTick() { const [tick, setTick] = useState(0); useEffect(() => S.subscribe(() => setTick((t) => t + 1)), []); return tick; }

  // --- SISTEM HITUNG HPP BERBASIS YIELD KAPASITAS PRODUKSI ---
  var hitungTotalBahanPokokPerPcs = () => {
    const bahan = S.get("bahanPokok") || [];
    return bahan.reduce((total, b) => {
      const kapasitas = parseFloat(b.jadiPcs) || 0;
      const hargaBeli = parseFloat(b.harga) || 0;
      if (kapasitas > 0) return total + (hargaBeli / kapasitas);
      return total;
    }, 0);
  };

  var hitungHPP = (menu) => {
    const modalPokokPerPcs = hitungTotalBahanPokokPerPcs();
    const bahan = S.get("bahanPokok") || [];
    const modalVarianPerPcs = (menu.resepBahanPokok || []).reduce((a, r) => {
      const b = bahan.find((x) => x.id === r.bahanId); if (!b) return a;
      const kapasitasVarian = parseFloat(r.gram) || 0;
      const hargaBeliVarian = parseFloat(b.harga) || 0;
      if (kapasitasVarian > 0) return a + (hargaBeliVarian / kapasitasVarian);
      return a;
    }, 0);
    const modalTopingTambahan = (menu.resepToping || []).reduce((a, t) => a + (parseFloat(t.harga) || 0), 0);
    return Math.ceil(modalPokokPerPcs + modalVarianPerPcs + modalTopingTambahan);
  };

  function Modal({ title, onClose, children }) {
    return React.createElement("div", { className: "modal-backdrop", onClick: onClose }, React.createElement("div", { className: "modal-box", onClick: (e) => e.stopPropagation() }, React.createElement("div", { className: "modal-header" }, React.createElement("span", null, title), React.createElement("button", { className: "btn-icon", onClick: onClose }, "X")), React.createElement("div", { className: "modal-body" }, children)));
  }

  function Notif({ msg, type, onClose }) {
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
    return React.createElement("div", { className: "notif notif-" + type }, React.createElement("span", { style: { flex: 1 } }, msg), React.createElement("button", { onClick: onClose }, "X"));
  }

  function BarChart({ data, height }) {
    const max = Math.max(...data.map((d) => Math.max(d.v1 || 0, d.v2 || 0)), 1);
    return React.createElement("div", { className: "bar-chart", style: { height: (height || 100) + 24 } }, data.map((d, i) => React.createElement("div", { key: i, className: "bar-col" }, React.createElement("div", { className: "bar-wrap", style: { height: height || 100 } }, React.createElement("div", { className: "bar-fill bar-a", style: { height: (d.v1 || 0) / max * 100 + "%" } }), React.createElement("div", { className: "bar-fill bar-b", style: { height: (d.v2 || 0) / max * 100 + "%" } })), React.createElement("div", { className: "bar-label" }, d.label))));
  }

  function LoginPage() {
    const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
    const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
    const doLogin = async () => {
      setErr(""); const u = String(username || "").trim(); if (!u || !password) { setErr("Masukkan nama user/email dan password."); return; }
      try {
        setBusy(true); const emailFormat = u.includes("@") ? u : `${u.toLowerCase()}@donatboss.local`;
        const { error } = await sb.auth.signInWithPassword({ email: emailFormat, password: password }); if (error) throw error;
      } catch (ex) { setErr(ex?.message || String(ex)); } finally { setBusy(false); }
    };
    return React.createElement("div", { className: "login-wrap" }, React.createElement("div", { className: "login-card" }, React.createElement("div", { style: { fontSize: 52, textAlign: "center" } }, "EVORA"), React.createElement("h1", { className: "login-title" }, "DONAT"), React.createElement("p", { className: "login-sub" }, "Masuk privat menggunakan Kata Sandi tanpa tautan email."), React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Nama User / Username / Email"), React.createElement("input", { className: "inp", value: username, onChange: (e) => setUsername(e.target.value), placeholder: "Ketik nama user atau email..." })), React.createElement("div", { className: "field-group", style: { marginTop: 8 } }, React.createElement("label", null, "Kata Sandi (Password)"), React.createElement("input", { className: "inp", type: "password", value: password, onChange: (e) => setPassword(e.target.value), onKeyDown: (e) => e.key === "Enter" && doLogin(), placeholder: "Masukkan kata sandi..." })), err && React.createElement("p", { style: { color: "#ef4444", fontSize: 13, marginTop: 4 } }, err), React.createElement("button", { className: "btn-primary btn-full", onClick: doLogin, disabled: busy, style: { marginTop: 12 } }, busy ? "Memverifikasi..." : "Masuk")));
  }

  function WorkerPage({ pushNotif, me, mode = "worker" }) {
    const tick = useStoreTick();
    const [tab, setTab] = useState(() => localStorage.getItem("evora_tab") || "kasir");
    const [cart, setCart] = useState(() => { try { const saved = localStorage.getItem("evora_cart"); if (!saved) return []; const parsed = JSON.parse(saved); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } });
    const [customAbsDate, setCustomAbsDate] = useState(today());
    
    useEffect(() => { localStorage.setItem("evora_tab", tab); localStorage.setItem("evora_cart", JSON.stringify(cart)); }, [tab, cart]);

    const [branches, setBranches] = useState(() => S.get("branches") || []);
    const [branchId, setBranchId] = useState(() => me?.branchId || (S.get("branches") || [{}])[0]?.id || "");
    const [menus, setMenus] = useState(() => S.get("menuVarian") || []);
    const [topings, setTopings] = useState(() => S.get("topingTambahan") || []);
    const [txDate, setTxDate] = useState(today()); const [editModal, setEditModal] = useState(null);
    const userId = me?.user_id;

    useEffect(() => { setBranches(S.get("branches") || []); setMenus(S.get("menuVarian") || []); setTopings(S.get("topingTambahan") || []); if (me?.branchId) setBranchId(me.branchId); }, [tick, me?.branchId]);

    const curBranch = branches.find((b) => b.id === branchId);
    const transactions = (S.get("transactions") || []).filter((t) => t.branchId === branchId && t.date === txDate);
    const branchOmzet = transactions.reduce((a, t) => a + t.total, 0);
    const branchPeng = (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date === txDate).reduce((a, p) => a + p.jumlah, 0);

    const addToCart = (menu) => setCart((c) => {
      const ex = c.find((x) => x.menuId === menu.id); if (ex) return c.map((x) => x.menuId === menu.id ? { ...x, qty: x.qty + 1 } : x);
      let hppTotalItem = hitungHPP(menu);
      if (menu.tipe === "paket") { const isiPcs = parseInt(menu.isiBox) || 1; const modalBoxCasing = parseFloat(menu.hargaBoxCasing) || 0; hppTotalItem = (hitungHPP({ tipe: "satuan" }) * isiPcs) + modalBoxCasing; }
      return [...c, { id: uid(), menuId: menu.id, topingId: null, nama: menu.nama, tipe: menu.tipe || "satuan", isiBox: menu.isiBox || null, hargaJual: menu.hargaJual, hpp: hppTotalItem, qty: 1 }];
    });

    const addToping = (tp) => setCart((c) => {
      const ex = c.find((x) => x.topingId === tp.id); if (ex) return c.map((x) => x.topingId === tp.id ? { ...x, qty: x.qty + 1 } : x);
      return [...c, { id: uid(), menuId: null, topingId: tp.id, nama: tp.nama + " (Toping)", tipe: "toping", hargaJual: tp.hargaJual, hpp: tp.hargaBahan, qty: 1 }];
    });

    const removeCart = (id) => setCart((c) => c.filter((x) => x.id !== id));
    const totalBayar = cart.reduce((a, x) => a + x.hargaJual * x.qty, 0);

    const submitTx = () => {
      if (!cart.length) return;
      if (mode === "worker") {
        const abs = (S.get("absensi") || []).find((a) => a.user_id === userId && a.date === txDate);
        if (!abs?.checkin_ts) { alert("Silakan check-in absensi dulu sebelum input transaksi."); return; }
      }
      const txs = S.get("transactions") || [];
      S.set("transactions", [...txs, { id: uid(), branchId, date: txDate, ts: nowTs(), items: cart.map((x) => ({ ...x })), total: totalBayar, totalHPP: cart.reduce((a, x) => a + x.hpp * x.qty, 0) }]);
      setCart([]); localStorage.removeItem("evora_cart"); pushNotif("Transaksi disimpan!", "success");
    };

    const saveEdit = (txId, newItems, alasan) => {
      const txs = S.get("transactions") || []; const old = txs.find((x) => x.id === txId);
      S.set("transactions", txs.map((t) => t.id === txId ? { ...t, items: newItems, total: newItems.reduce((a, x) => a + x.hargaJual * x.qty, 0), totalHPP: newItems.reduce((a, x) => a + x.hpp * x.qty, 0), edited: true } : t));
      const logs = S.get("editLog") || []; S.set("editLog", [...logs, { id: uid(), ts: nowTs(), txId, branchId, branchName: curBranch?.name || branchId, alasan, before: old?.items || [], after: newItems }]);
      setEditModal(null); pushNotif("Transaksi diperbarui.", "warning");
    };

    const getSetoran = useCallback(() => { const s = S.get("setoranHarian") || []; return s.find((x) => x.branchId === branchId && x.date === txDate) || { status: "belum" }; }, [branchId, txDate]);
    const [setoran, setSetoran] = useState(getSetoran); useEffect(() => setSetoran(getSetoran()), [getSetoran]);
    const doSetoran = () => {
      const s = S.get("setoranHarian") || []; const existing = s.find((x) => x.branchId === branchId && x.date === txDate);
      const entry = { id: existing?.id || uid(), branchId, branchName: curBranch?.name || branchId, date: txDate, ts: nowTs(), status: "menunggu", omzet: branchOmzet, pengeluaran: branchPeng };
      S.set("setoranHarian", existing ? s.map((x) => x.id === entry.id ? entry : x) : [...s, entry]); setSetoran(entry); pushNotif("Setoran dikirim!", "success");
    };

    const allowSetoran = mode === "worker"; const TABS = allowSetoran ? ["kasir", "riwayat", "pengeluaran", "setoran", "absensi"] : ["kasir", "riwayat", "pengeluaran", "absensi"];
    const TAB_LABELS = { kasir: "Kasir", riwayat: "Riwayat", pengeluaran: "Pengeluaran", setoran: "Setoran", absensi: "Absensi" };
    const [absMonth, setAbsMonth] = useState(today().slice(0, 7));
    const currentSelectedAbs = useMemo(() => { const all = S.get("absensi") || []; return all.find((a) => a.user_id === userId && a.date === customAbsDate) || null; }, [tick, userId, customAbsDate]);

    const doCheckin = () => {
      if (!userId) return; const dObj = new Date(customAbsDate); const namaHariTerpilih = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][dObj.getDay()];
      const jadwalLibur = S.get("jadwalLibur") || {}; const liburKu = jadwalLibur[userId];
      if (liburKu && liburKu === namaHariTerpilih) { alert(`Akses ditolak!\n\nHari ${namaHariTerpilih} adalah Jadwal Libur Anda. Absensi diblokir.`); return; }
      const all = S.get("absensi") || []; const ex = all.find((a) => a.user_id === userId && a.date === customAbsDate);
      if (ex?.checkin_ts) { pushNotif("Check-in tanggal ini sudah diinput.", "warning"); return; }
      const row = { id: uid(), user_id: userId, branchId: me?.branchId || branchId, date: customAbsDate, checkin_ts: customAbsDate + " 08:00:00", checkout_ts: null };
      S.set("absensi", [...all, row]); pushNotif("Check-in tanggal " + customAbsDate + " disimpan.", "success");
    };

    const doCheckout = () => {
      if (!userId) return; const all = S.get("absensi") || []; const ex = all.find((a) => a.user_id === userId && a.date === customAbsDate);
      if (!ex?.checkin_ts) { pushNotif("Belum ada data Check-in pada tanggal tersebut.", "warning"); return; }
      if (ex?.checkout_ts) { pushNotif("Sudah checkout pada tanggal tersebut.", "warning"); return; }
      const row = { ...ex, checkout_ts: customAbsDate + " 17:00:00" }; S.set("absensi", all.map((a) => a.id === row.id ? row : a)); pushNotif("Check-out disimpan.", "success");
    };

    const myMonthRows = useMemo(() => { const all = S.get("absensi") || []; return all.filter((a) => a.user_id === userId && String(a.date || "").startsWith(absMonth)); }, [tick, userId, absMonth]);
    const monthSnap = useMemo(() => { const snaps = S.get("absensiBulanan") || []; return snaps.find((s) => s.user_id === userId && s.bulan === absMonth && s.locked) || null; }, [tick, userId, absMonth]);
    const calcMonth = useMemo(() => { let hadir = 0; for (const r of myMonthRows) { if (r.checkin_ts) hadir += 1; } return { hadir }; }, [myMonthRows]);

    return React.createElement("div", { className: "page" }, 
      React.createElement("div", { className: "page-header" }, React.createElement("img", { className: "page-icon", src: "./logo.jpg", style: { width: 45, height: 45, objectFit: "cover", borderRadius: 10 } }), React.createElement("div", null, React.createElement("h2", null, "Halaman Kasir"), React.createElement("p", { className: "page-sub" }, curBranch?.name || "—"))), 
      React.createElement("div", { className: "row-wrap mb8" }, React.createElement("select", { className: "inp inp-sm", value: branchId, onChange: (e) => setBranchId(e.target.value), disabled: !!me?.branchId }, branches.map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name))), React.createElement("input", { type: "date", className: "inp inp-sm", value: txDate, onChange: (e) => setTxDate(e.target.value) })), 
      React.createElement("div", { className: "tabs" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TAB_LABELS[t]))), 
      tab === "kasir" && React.createElement("div", { className: "kasir-layout" }, 
        React.createElement("div", null, React.createElement("h3", { className: "section-title" }, "Menu Satuan"), React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe !== "paket").map((m) => React.createElement("button", { key: m.id, className: "menu-card", onClick: () => addToCart(m), style: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" } }, m.imgUrl ? React.createElement("img", { src: m.imgUrl, style: { width: "100%", height: "90px", objectFit: "cover" } }) : React.createElement("div", { style: { width: "100%", height: "90px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 } }, "No Photo"), React.createElement("div", { style: { padding: "8px", flex: 1 } }, React.createElement("div", { className: "menu-name" }, m.nama), React.createElement("div", { className: "menu-price" }, fmtRp(m.hargaJual)))))), React.createElement("h3", { className: "section-title mt12" }, "Box / Paket"), React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe === "paket").map((m) => React.createElement("button", { key: m.id, className: "menu-card menu-card-paket", onClick: () => addToCart(m), style: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" } }, m.imgUrl ? React.createElement("img", { src: m.imgUrl, style: { width: "100%", height: "90px", objectFit: "cover" } }) : React.createElement("div", { style: { width: "100%", height: "90px", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 } }, "No Photo"), React.createElement("div", { style: { padding: "8px", flex: 1 } }, React.createElement("div", { className: "menu-name" }, m.nama), React.createElement("div", { className: "menu-price" }, fmtRp(m.hargaJual)))))), React.createElement("h3", { className: "section-title mt12" }, "Toping Tambahan"), React.createElement("div", { className: "menu-grid" }, topings.map((t) => React.createElement("button", { key: t.id, className: "menu-card menu-card-toping", onClick: () => addToping(t) }, React.createElement("div", { className: "menu-name" }, t.nama), React.createElement("div", { className: "menu-price" }, fmtRp(t.hargaJual)))))), 
        React.createElement("div", { className: "cart-section" }, React.createElement("h3", { className: "section-title" }, "Keranjang"), cart.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada item"), cart.map((item) => React.createElement("div", { key: item.id, className: "cart-item" }, React.createElement("div", { className: "cart-item-info" }, React.createElement("span", null, item.nama), React.createElement("span", { className: "cart-qty" }, "x", item.qty)), React.createElement("div", { className: "cart-item-right" }, React.createElement("span", null, fmtRp(item.hargaJual * item.qty)), React.createElement("button", { className: "btn-danger-sm", onClick: () => removeCart(item.id) }, "X")))), cart.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", { className: "cart-total" }, "Total: ", React.createElement("strong", null, fmtRp(totalBayar))), React.createElement("div", { className: "row-wrap" }, React.createElement("button", { className: "btn-secondary", onClick: () => { setCart([]); localStorage.removeItem("evora_cart"); } }, "Batal"), React.createElement("button", { className: "btn-primary", onClick: submitTx }, "Simpan"))), React.createElement("div", { className: "omzet-box mt12" }, React.createElement("span", null, "Omzet Hari Ini"), React.createElement("strong", null, fmtRp(branchOmzet))), React.createElement("div", { className: "omzet-box", style: { borderColor: "#5a1a1a" } }, React.createElement("span", null, "Pengeluaran Lapak"), React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(branchPeng))))), 
      tab === "riwayat" && React.createElement("div", null, React.createElement("h3", { className: "section-title" }, "Riwayat - ", txDate), transactions.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada transaksi"), [...transactions].reverse().map((tx) => React.createElement("div", { key: tx.id, className: "tx-card" }, React.createElement("div", { className: "tx-header" }, React.createElement("span", { className: "tx-id" }, "STRUK-", tx.id.slice(0, 6).toUpperCase())), tx.items.map((it, i) => React.createElement("div", { key: i, className: "tx-item" }, it.nama, " x", it.qty, " - ", fmtRp(it.hargaJual * it.qty))), React.createElement("div", { className: "tx-total" }, "Total: ", fmtRp(tx.total)), React.createElement("button", { className: "btn-edit-sm", onClick: () => setEditModal(tx) }, "Edit")))), 
      tab === "pengeluaran" && React.createElement(PengeluaranLapak, { branchId, branchName: curBranch?.name || "", date: txDate, pushNotif }), 
      allowSetoran && tab === "setoran" && React.createElement("div", { className: "setoran-box-worker" }, React.createElement("div", { className: "setoran-status setoran-" + setoran.status }, React.createElement("span", null, setoran.status === "belum" ? "Belum Setor" : "Menunggu Verifikasi")), React.createElement("button", { className: "btn-primary btn-full", onClick: doSetoran, disabled: setoran.status !== "belum" }, "Setor Sekarang")), 
      tab === "absensi" && React.createElement("div", null, React.createElement("h3", { className: "section-title mt8" }, "Input Rekap Absensi Manual (Bisa Mundur 6 Bulan)"), React.createElement("div", { className: "form-card" }, React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Atur Tanggal Kerja:"), React.createElement("input", { type: "date", className: "inp", value: customAbsDate, onChange: (e) => setCustomAbsDate(e.target.value) })), React.createElement("div", { className: "row-wrap", style: { justifyContent: "space-between", marginTop: 8 } }, React.createElement("div", null, React.createElement("div", { style: { fontWeight: 700 } }, "Status Data Tanggal Terpilih:"), React.createElement("div", null, currentSelectedAbs ? "Sudah Diinput" : "Belum Ada Data")), React.createElement("div", { className: "row-wrap" }, React.createElement("button", { className: "btn-primary btn-sm", onClick: doCheckin }, "Input Masuk"), React.createElement("button", { className: "btn-secondary btn-sm", onClick: doCheckout }, "Input Keluar")))), React.createElement("div", { className: "field-group mt8" }, React.createElement("label", null, "Pilih Bulan Grafik:"), React.createElement("input", { type: "month", className: "inp inp-sm", value: absMonth, onChange: (e) => setAbsMonth(e.target.value) })), React.createElement("div", { className: "kpi-grid" }, React.createElement("div", { className: "kpi-card kpi-omzet" }, React.createElement("div", { className: "kpi-label" }, "Total Hadir"), React.createElement("div", { className: "kpi-val" }, (monthSnap ? monthSnap.total_hadir : calcMonth.hadir), " Hari")))), 
      editModal && React.createElement(EditTxModal, { tx: editModal, onClose: () => setEditModal(null), onSave: saveEdit })
    );
  }

  function PengeluaranLapak({ branchId, branchName, date, pushNotif }) {
    const getList = () => (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date === date); const [list, setList] = useState(getList); const [form, setForm] = useState({ keterangan: "", jumlah: "" }); const refresh = () => setList(getList());
    const tambah = () => { if (!form.keterangan || !form.jumlah) return; const all = S.get("pengeluaranLapak") || []; S.set("pengeluaranLapak", [...all, { id: uid(), branchId, branchName, date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah) }]); setForm({ keterangan: "", jumlah: "" }); refresh(); pushNotif("Tersimpan", "success"); };
    return React.createElement("div", null, React.createElement("div", { className: "form-card" }, React.createElement("input", { className: "inp mb4", placeholder: "Beli nota...", value: form.keterangan, onChange: (e) => setForm({ ...form, keterangan: e.target.value }) }), React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Nominal uang...", value: form.jumlah, onChange: (e) => setForm({ ...form, jumlah: e.target.value }) }), React.createElement("button", { className: "btn-primary", onClick: tambah }, "Tambah Nota Lapak")));
  }

  function EditTxModal({ tx, onClose, onSave }) {
    const [items, setItems] = useState(tx.items.map((x) => ({ ...x }))); const [alasan, setAlasan] = useState("");
    return React.createElement(Modal, { title: "Edit Nota", onClose }, React.createElement("input", { className: "inp mb4", placeholder: "Alasan edit...", value: alasan, onChange: (e) => setAlasan(e.target.value) }), React.createElement("button", { className: "btn-primary", onClick: () => onSave(tx.id, items, alasan) }, "Update Transaksi"));
  }

  function OwnerPage({ pushNotif, me }) {
    const tick = useStoreTick(); const [tab, setTab] = useState("dashboard"); const [stab, setStab] = useState("hpp");
    const TABS = ["dashboard", "kasir", "setoran", "laporan", "absensi", "pengeluaran", "setting"];
    const TLABEL = { dashboard: "Dashboard", kasir: "Kasir", setoran: "Setoran", laporan: "Laporan", absensi: "Absensi", pengeluaran: "Pengeluaran", setting: "Seting" };
    return React.createElement("div", { className: "page" }, 
      React.createElement("div", { className: "page-header" }, React.createElement("h2", null, "Panel Kontrol Utama Owner")), 
      React.createElement("div", { className: "tabs tabs-scroll" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TLABEL[t]))), 
      tab === "dashboard" && React.createElement(OwnerDashboard), tab === "kasir" && React.createElement(WorkerPage, { pushNotif, me, mode: "owner" }), tab === "pengeluaran" && React.createElement(PengeluaranOwner, { pushNotif }), tab === "setting" && React.createElement(OwnerSetting, { stab, setStab, pushNotif }), tab === "absensi" && React.createElement(OwnerAbsensi)
    );
  }

  function OwnerDashboard() {
    const txs = S.get("transactions") || []; const branches = S.get("branches") || [];
    return React.createElement("div", null, React.createElement("div", { className: "kpi-grid mt8" }, React.createElement("div", { className: "kpi-card kpi-omzet" }, React.createElement("div", { className: "kpi-label" }, "Omzet Global Keseluruhan"), React.createElement("div", { className: "kpi-val" }, fmtRp(txs.reduce((a, x) => a + x.total, 0))))));
  }

  // --- FORM INPUT OPERASIONAL OWNER BERBASIS PILIHAN CABANG ---
  function PengeluaranOwner({ pushNotif }) {
    const [date, setDate] = useState(today()); const [selBranch, setSelBranch] = useState("all"); const branches = S.get("branches") || [];
    const [list, setList] = useState(() => S.get("pengeluaranOwner") || []);
    const [form, setForm] = useState({ keterangan: "", jumlah: "", targetBranchId: "", kategori: "gaji_pekerja" });
    const refresh = () => setList(S.get("pengeluaranOwner") || []);
    const tambah = () => {
      if (!form.keterangan || !form.jumlah || !form.targetBranchId) { alert("Pilih penempatan alokasi cabang dulu bos!"); return; }
      const all = S.get("pengeluaranOwner") || []; S.set("pengeluaranOwner", [...all, { id: uid(), date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah), kategori: form.kategori, branchId: form.targetBranchId }]);
      setForm({ ...form, keterangan: "", jumlah: "" }); refresh(); pushNotif("Pengeluaran pusat disimpan!", "success");
    };
    const filtered = list.filter((p) => p.date === date && (selBranch === "all" || p.branchId === selBranch));
    return React.createElement("div", null, 
      React.createElement("div", { className: "form-card" }, React.createElement("h4", null, "Input Pengeluaran Pusat Per Cabang"), React.createElement("label", null, "Alokasi Target Cabang:"), React.createElement("select", { className: "inp mb4", value: form.targetBranchId, onChange: (e) => setForm({ ...form, targetBranchId: e.target.value }) }, React.createElement("option", { value: "" }, "-- Pilih Cabang --"), branches.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))), React.createElement("input", { className: "inp mb4", placeholder: "Keterangan biaya (Contoh: Gaji Pekerja)...", value: form.keterangan, onChange: (e) => setForm({ ...form, keterangan: e.target.value }) }), React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Nominal uang...", value: form.jumlah, onChange: (e) => setForm({ ...form, jumlah: e.target.value }) }), React.createElement("button", { className: "btn-primary", onClick: tambah }, "Simpan Biaya Pusat")),
      React.createElement("h3", { className: "section-title mt12" }, "History Biaya Pusat Terdistribusi"), filtered.map(p => React.createElement("div", { key: p.id, className: "peng-row" }, React.createElement("span", null, p.keterangan, " (", branches.find(b=>b.id===p.branchId)?.name, ")"), React.createElement("strong", null, fmtRp(p.jumlah))))
    );
  }

  function OwnerAbsensi() {
    const abs = S.get("absensi") || []; const profiles = S.get("profiles") || [];
    return React.createElement("div", null, React.createElement("h3", { className: "section-title mt8" }, "Detail Riwayat Jam Masuk Pekerja"), abs.map(h => React.createElement("div", { key: h.id, className: "peng-row" }, React.createElement("span", null, profiles.find(p=>p.user_id===h.user)?.display_name || "Kasir", " - Tanggal: ", h.date), React.createElement("strong", null, "Status: Hadir"))));
  }

  function OwnerSetting({ stab, setStab, pushNotif }) {
    const TABS = ["hpp", "paket", "akun"]; const TLABEL = { hpp: "HPP Bahan Pokok", paket: "HPP Paket Box", akun: "Atur Hari Libur" };
    return React.createElement("div", null, React.createElement("div", { className: "tabs tabs-sm" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (stab === t ? " active" : ""), onClick: () => setStab(t) }, TLABEL[t]))), stab === "hpp" && React.createElement(SettingHPP, { pushNotif }), stab === "paket" && React.createElement(SettingPaket, { pushNotif }), stab === "akun" && React.createElement(SettingAkun, { pushNotif }));
  }

  function SettingHPP({ pushNotif }) {
    const [bahan, setBahan] = useState(() => S.get("bahanPokok") || []); const [menus, setMenus] = useState(() => (S.get("menuVarian") || []).filter(m=>m.tipe!=="paket")); const [editMenu, setEditMenu] = useState(null);
    const [nB, setNB] = useState({ nama: "", harga: "", jadiPcs: "" });
    const saveB = () => {
      if (!nB.nama || !nB.harga || !nB.jadiPcs) return; const u = [...bahan, { id: uid(), nama: nB.nama, harga: parseFloat(nB.harga), jadiPcs: parseInt(nB.jadiPcs) }];
      S.set("bahanPokok", u); setBahan(u); setNB({ nama: "", harga: "", jadiPcs: "" }); pushNotif("Komponen Pokok Ditambah!", "success");
    };
    return React.createElement("div", null, 
      React.createElement("h4", null, "Harga Bahan Baku Pokok Per Kapasitas Jadi Pcs"), React.createElement("p", { className: "info-txt" }, "Total Beban Adonan Pokok: ", fmtRp(hitungTotalBahanPokokPerPcs()), " / porsi pcs"), 
      React.createElement("div", { className: "form-card mt4" }, React.createElement("input", { className: "inp mb4", placeholder: "Nama bahan adonan...", value: nB.nama, onChange: (e) => setNB({ ...nB, nama: e.target.value }) }), React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Harga beli per karung/pack...", value: nB.harga, onChange: (e) => setNB({ ...nB, harga: e.target.value }) }), React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Bisa jadi berapa pcs donat...", value: nB.jadiPcs, onChange: (e) => setNB({ ...nB, jadiPcs: e.target.value }) }), React.createElement("button", { className: "btn-primary btn-full", onClick: saveB }, "Tambah Bahan Baku")),
      React.createElement("h3", { className: "section-title mt12" }, "Setting Resep Varian Topping Satuan"), menus.map(m => React.createElement("div", { key: m.id, className: "menu-setting-card" }, React.createElement("strong", null, m.nama, " (HPP: ", fmtRp(hitungHPP(m)), ")"), React.createElement("button", { className: "btn-secondary btn-sm mt4", onClick: () => setEditMenu(m) }, "Konfigurasi Topping"))),
      editMenu && React.createElement(EditMenuModal, { menu: editMenu, bahan, onSave: (updated) => { const all = S.get("menuVarian") || []; S.set("menuVarian", all.map(x=>x.id===updated.id?updated:x)); setMenus(S.get("menuVarian").filter(x=>x.tipe!=="paket")); setEditMenu(null); }, onClose: () => setEditMenu(null) })
    );
  }

  function SettingPaket({ pushNotif }) {
    const [pakets, setPakets] = useState(() => (S.get("menuVarian") || []).filter(m => m.tipe === "paket")); const [editP, setEditP] = useState(null);
    const save = (target) => { const all = S.get("menuVarian") || []; S.set("menuVarian", all.map(x=>x.id===target.id?target:x)); setPakets(S.get("menuVarian").filter(x=>x.tipe==="paket")); setEditP(null); };
    return React.createElement("div", null, 
      React.createElement("h3", null, "Aturan Dasar Kemasan Box"), pakets.map(p => {
        const isi = parseInt(p.isiBox) || 1; const casing = parseFloat(p.hargaBoxCasing) || 0; const hppKue = hitungHPP({ tipe: "satuan" }) * isi; const hppBox = hppKue + casing;
        return React.createElement("div", { key: p.id, className: "menu-setting-card" }, React.createElement("strong", null, p.name), React.createElement("div", null, "Isi: ", isi, " pcs | Modal Box Kardus: ", fmtRp(casing)), React.createElement("div", null, "HPP Gabungan: ", fmtRp(hppBox), " | Jual: ", fmtRp(p.hargaJual)), React.createElement("div", { style: { color: "#22c55e", fontWeight: "bold" } }, "Keuntungan Bersih (Bati Box): ", fmtRp(p.hargaJual - hppBox)), React.createElement("button", { className: "btn-secondary btn-sm mt4", onClick: () => setEditP(p) }, "Ubah Struktur Box"));
      }),
      editP && React.createElement(Modal, { title: "Ubah Konfigurasi Box", onClose: () => setEditP(null) }, React.createElement("label", null, "Isi Berapa Pcs Per Box:"), React.createElement("input", { className: "inp mb4", type: "number", value: editP.isiBox, onChange: (e) => setEditP({ ...editP, isiBox: parseInt(e.target.value) }) }), React.createElement("label", null, "Modal Harga Kardus Kotak:"), React.createElement("input", { className: "inp mb4", type: "number", value: editP.hargaBoxCasing, onChange: (e) => setEditP({ ...editP, hargaBoxCasing: parseFloat(e.target.value) }) }), React.createElement("label", null, "Harga Jual Box Jadi:"), React.createElement("input", { className: "inp mb4", type: "number", value: editP.hargaJual, onChange: (e) => setEditP({ ...editP, hargaJual: parseFloat(e.target.value) }) }), React.createElement("button", { className: "btn-primary btn-full mt4", onClick: () => save(editP) }, "Simpan Aturan Paket"))
    );
  }

  function EditMenuModal({ menu, bahan, onSave, onClose }) {
    const [m, setM] = useState({ ...menu, resepBahanPokok: menu.resepBahanPokok || [], imgUrl: menu.imgUrl || "" }); const [nRB, setNRB] = useState({ bahanId: bahan[0]?.id || "", porsiJadiPcs: "" });
    const [uploading, setUploading] = useState(false);
    const handleUpload = async (e) => {
      const file = e.target.files[0]; if (!file) return; setUploading(true);
      try {
        const fName = `${uid()}.${file.name.split('.').pop()}`; const { error } = await sb.storage.from("menu-images").upload(fName, file); if (error) throw error;
        const { data } = sb.storage.from("menu-images").getPublicUrl(fName); setM({ ...m, imgUrl: data.publicUrl });
      } catch (err) { alert("Gagal upload foto!"); } finally { setUploading(false); }
    };
    const tambahResep = () => { if (!nRB.porsiJadiPcs) return; setM({ ...m, resepBahanPokok: [...m.resepBahanPokok, { bahanId: nRB.bahanId, gram: parseFloat(nRB.porsiJadiPcs) }] }); setNRB({ ...nRB, porsiJadiPcs: "" }); };
    return React.createElement(Modal, { title: "Setting Resep Kue & Gambar", onClose }, 
      React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Upload Gambar Menu Dari HP:"), m.imgUrl && React.createElement("img", { src: m.imgUrl, style: { width: 80, height: 80, objectFit: "cover", borderRadius: 8, display: "block", marginBottom: 6 } }), React.createElement("input", { type: "file", accept: "image/*", onChange: handleUpload, disabled: uploading }), uploading && React.createElement("p", null, "Mengunggah...")), 
      React.createElement("div", { className: "field-group mt8" }, React.createElement("label", null, "Harga Jual Satuan (Rp):"), React.createElement("input", { className: "inp", type: "number", value: m.hargaJual, onChange: (e) => setM({ ...m, hargaJual: parseFloat(e.target.value) }) })), 
      React.createElement("h4", { className: "sub-title mt8" }, "Kalkulasi Komposisi Topping:"), 
      React.createElement("div", { className: "add-row" }, React.createElement("select", { className: "inp inp-sm", value: nRB.bahanId, onChange: (e) => setNRB({ ...nRB, bahanId: e.target.value }) }, bahan.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))), React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "1 Pack topping jadi berapa pcs kue...", value: nRB.porsiJadiPcs, onChange: (e) => setNRB({ ...nRB, porsiJadiPcs: e.target.value }) }), React.createElement("button", { className: "btn-primary btn-sm", onClick: tambahResep }, "+")), 
      React.createElement("div", { className: "hpp-preview mt12" }, React.createElement("div", null, "Bahan Baku Dasar Adonan: ", fmtRp(hitungTotalBahanPokokPerPcs()), " / pcs"), React.createElement("strong", null, "Total Estimasi HPP Gabungan: ", fmtRp(hitungHPP(m)), " / pcs")), 
      React.createElement("button", { className: "btn-primary btn-full mt12", onClick: () => onSave(m) }, "Simpan Menu")
    );
  }

  function SettingAkun({ pushNotif }) {
    const profiles = S.get("profiles") || []; const [jadwalLibur, setJadwalLibur] = useState(() => S.get("jadwalLibur") || {});
    const updateLibur = (uId, hari) => { const b = { ...jadwalLibur, [uId]: hari }; S.set("jadwalLibur", b); setJadwalLibur(b); pushNotif("Sukses set hari libur!", "success"); };
    return React.createElement("div", null, React.createElement("h3", null, "Kunci Hari Libur Operasional Kasir"), profiles.filter(p => p.role === "worker").map(p => React.createElement("div", { key: p.user_id, className: "branch-row" }, React.createElement("span", null, p.display_name || p.email), React.createElement("select", { value: jadwalLibur[p.user_id] || "", onChange: (e) => updateLibur(p.user_id, e.target.value) }, React.createElement("option", { value: "" }, "-- Masuk Kerja Terus --"), ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"].map(h => React.createElement("option", { key: h, value: h }, h))))));
  }

  // --- PORTAL INVESTOR: BREAKDOWN TRANSPARANSI DATA NOTA SUPER RINCI ---
  function InvestorPage({ investorId }) {
    const txDate = today(); const txs = S.get("transactions") || [];
    const pLapak = S.get("pengeluaranLapak") || []; const pOwner = S.get("pengeluaranOwner") || [];
    const branches = (S.get("branches") || []).filter(b => b.type === "investasi" && (!investorId || b.investorId === investorId));
    return React.createElement("div", { className: "page" }, React.createElement("div", { className: "page-header" }, React.createElement("h2", null, "Portal Investor Transparansi Penuh")), 
      branches.map(b => {
        const dayTxs = txs.filter(t => t.branchId === b.id && t.date === txDate);
        const notaLapak = pLapak.filter(p => p.branchId === b.id && p.date === txDate);
        const notaPusat = pOwner.filter(p => p.branchId === b.id && p.date === txDate);
        return React.createElement("div", { key: b.id, className: "investor-report-card mt12", style: { border: "1px solid #444", padding: "12px", borderRadius: "8px" } }, 
          React.createElement("h3", null, "Lokasi Cabang: ", b.name), React.createElement("div", { style: { color: "#22c55e", fontWeight: "bold" } }, "Omzet Realtime Masuk: ", fmtRp(dayTxs.reduce((a,x)=>a+x.total,0))), 
          React.createElement("h4", { style: { color: "#f87171", marginTop: "8px" } }, "🛑 BREAKDOWN DETAIL NOTA PENGELUARAN LAPAK (KASIR):"), 
          // Rincian nota kasir mendetail per item pLapak array
          notaLapak.length === 0 ? React.createElement("p", null, "• Tidak ada nota pengeluaran lapak hari ini.") : notaLapak.map(p => React.createElement("div", { key: p.id, style: { fontSize: "13px", paddingLeft: "6px" } }, "- ", p.keterangan, " (", fmtRp(p.jumlah), ")")), 
          React.createElement("h4", { style: { color: "#f87171", marginTop: "8px" } }, "🛑 BREAKDOWN DETAIL ALOKASI OPERASIONAL OWNER (PUSAT):"), 
          // Rincian alokasi biaya owner ter-tagging per cabang mendetail per item pOwner array
          notaPusat.length === 0 ? React.createElement("p", null, "• Tidak ada alokasi pengeluaran pusat hari ini.") : notaPusat.map(p => React.createElement("div", { key: p.id, style: { fontSize: "13px", paddingLeft: "6px" } }, "- ", p.keterangan, " [Kategori: ", p.kategori, "] (", fmtRp(p.jumlah), ")")), 
          React.createElement("div", { style: { borderTop: "1px dashed #555", marginTop: "10px", paddingTop: "6px", fontWeight: "bold" } }, "Total Kumulatif Seluruh Beban Pengeluaran: ", fmtRp(notaLapak.reduce((a,x)=>a+x.jumlah,0) + notaPusat.reduce((a,x)=>a+x.jumlah,0)))
        );
      })
    );
  }

  function App() {
    const [session, setSession] = useState(null); const [profile, setProfile] = useState(null);
    useEffect(() => { sb.auth.getSession().then(({data}) => setSession(data.session)); sb.auth.onAuthStateChange((_, s) => setSession(s)); }, []);
    useEffect(() => { if (session) { const profs = S.get("profiles") || []; sb.from("profiles").select("*").eq("user_id", session.user.id).single().then(({ data }) => { setProfile(data); S.loadAll(); S.startRealtime(); }); } }, [session]);
    if (!session) return React.createElement(LoginPage); if (!profile) return React.createElement("div", null, "Memuat Ekosistem Bisnis Donat Boss...");
    return profile.role === "owner" ? React.createElement(OwnerPage, { me: profile }) : profile.role === "investor" ? React.createElement(InvestorPage, { investorId: profile.investorId }) : React.createElement(WorkerPage, { me: profile });
  }

  var root = ReactDOM.createRoot(document.getElementById("root")); root.render(React.createElement(App));
})();
