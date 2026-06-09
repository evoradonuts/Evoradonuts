var DonatBoss = (() => {
  var { useState, useEffect, useCallback, useMemo } = React;
  var sb = window.sb;
  
  // Patch keamanan untuk hapus akun langsung via server endpoint
  try {
    const __rpc = sb.rpc.bind(sb);
    sb.rpc = async (fn, args) => {
      if (fn === "hapus_akun_langsung") {
        try {
          const { data: sessData } = await sb.auth.getSession();
          const token = sessData?.session?.access_token;
          if (!token) throw new Error("Owner harus login dulu.");
          const resp = await fetch("/api/delete-user", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify(args || {})
          });
          const text = await resp.text();
          let json = null;
          try { json = JSON.parse(text); } catch (e) {}
          if (!resp.ok) throw new Error(json?.error || text || "Gagal hapus akun.");
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
    const deepEq = (a, b) => { 
      try { return JSON.stringify(a) === JSON.stringify(b); } 
      catch (e) { return false; } 
    };
    
    const get = (k, def = null) => {
      if (LOCAL_KEYS.has(k)) {
        try { 
          const v = localStorage.getItem(k); 
          return v ? JSON.parse(v) : def; 
        } catch (e) { return def; }
      }
      return k in cache ? cache[k] : def;
    };
    
    const setLocal = (k, v) => {
      if (LOCAL_KEYS.has(k)) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
        emit(); 
        return;
      }
      cache[k] = v; 
      emit();
    };

    const setErrorHandler = (fn) => { onError = typeof fn === "function" ? fn : onError; };
    
    const loadKey = async (key) => {
      const table = TABLE_BY_KEY[key];
      if (!table) return;
      const { data, error } = await sb.from(table).select("*");
      if (error) throw error;
      cache[key] = data || [];
    };
    
    const loadAll = async () => {
      const keys = Object.keys(TABLE_BY_KEY).filter((k) => k !== "profiles");
      await Promise.all(keys.map((k) => loadKey(k)));
      emit();
    };

    const applyRealtime = (key, payload) => {
      const table = TABLE_BY_KEY[key];
      if (!table) return;
      const ev = payload.eventType;
      const rowNew = payload.new;
      const rowOld = payload.old;
      const id = rowNew && rowNew.id || rowOld && rowOld.id;
      if (!id) return;
      
      const cur = cache[key] || [];
      if (ev === "DELETE") { cache[key] = cur.filter((x) => x.id !== id); emit(); return; }
      if (ev === "INSERT") { cache[key] = [...cur.filter((x) => x.id !== id), rowNew]; emit(); return; }
      if (ev === "UPDATE") { cache[key] = cur.map((x) => x.id === id ? rowNew : x); emit(); return; }
    };

    const startRealtime = () => {
      stopRealtime();
      Object.entries(TABLE_BY_KEY).forEach(([key, table]) => {
        if (LOCAL_KEYS.has(key)) return;
        const ch = sb.channel("rt:" + table).on(
          "postgres_changes", { event: "*", schema: "public", table },
          (payload) => applyRealtime(key, payload)
        ).subscribe();
        channels.push(ch);
      });
    };

    const stopRealtime = () => { 
      channels.forEach((ch) => { try { sb.removeChannel(ch); } catch (e) {} }); 
      channels = []; 
    };

    const persistDiff = async (key, beforeArr, afterArr) => {
      const table = TABLE_BY_KEY[key];
      if (!table) return;
      
      const before = Array.isArray(beforeArr) ? beforeArr : [];
      const after = Array.isArray(afterArr) ? afterArr : [];
      const bMap = new Map(before.map((r) => [r.id, r]));
      const aMap = new Map(after.map((r) => [r.id, r]));
      
      const toInsert = [];
      const toUpdate = [];
      
      for (const [id, row] of aMap.entries()) {
        const prev = bMap.get(id);
        if (!prev) { toInsert.push(row); continue; }
        if (!deepEq(prev, row)) toUpdate.push(row);
      }
      
      const toDelete = [];
      for (const [id] of bMap.entries()) { if (!aMap.has(id)) toDelete.push(id); }
      
      if (toInsert.length) { const { error } = await sb.from(table).insert(toInsert); if (error) throw error; }
      if (toUpdate.length) {
        for (const row of toUpdate) {
          const { id, ...payload } = row;
          const { error } = await sb.from(table).update(payload).eq("id", id);
          if (error) throw error;
        }
      }
      if (toDelete.length) { const { error } = await sb.from(table).delete().in("id", toDelete); if (error) throw error; }
    };

    const set = (key, value) => {
      if (LOCAL_KEYS.has(key)) { setLocal(key, value); return; }
      const before = cache[key];
      cache[key] = value;
      emit();
      persistDiff(key, before, value).catch((e) => onError(e?.message || String(e)));
    };

    const reset = () => { stopRealtime(); cache = {}; emit(); };
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    return { get, set, setLocal, loadAll, loadKey, startRealtime, stopRealtime, reset, subscribe, setErrorHandler };
  })();

  var fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  var today = () => {
    const d = new Date();
    d.setHours(d.getHours() + 7);
    return d.toISOString().slice(0, 10); 
  };
  var nowTs = () => new Date().toLocaleString("id-ID");
  var nowIso = () => new Date().toISOString();
  var fmtTs = (v) => { 
    if (!v) return "-"; 
    try { return new Date(v).toLocaleString("id-ID"); } 
    catch (e) { return String(v); } 
  };

  function useStoreTick() {
    const [tick, setTick] = useState(0);
    useEffect(() => S.subscribe(() => setTick((t) => t + 1)), []);
    return tick;
  }

  // LOGIKA HPP: Hitung Total Bahan Pokok Per Pcs Jadi
  var hitungTotalBahanPokokPerPcs = () => {
    const bahan = S.get("bahanPokok") || [];
    return bahan.reduce((total, b) => {
      const kapasitas = parseFloat(b.jadiPcs) || 0;
      const hargaBeli = parseFloat(b.harga) || 0;
      if (kapasitas > 0) {
        return total + (hargaBeli / kapasitas);
      }
      return total;
    }, 0);
  };

  // LOGIKA HPP: Hitung HPP Produk Satuan/Varian Lengkap
  var hitungHPP = (menu) => {
    const modalPokokPerPcs = hitungTotalBahanPokokPerPcs();
    const bahan = S.get("bahanPokok") || [];
    
    const modalVarianPerPcs = (menu.resepBahanPokok || []).reduce((a, r) => {
      const b = bahan.find((x) => x.id === r.bahanId);
      if (!b) return a;
      const kapasitasVarian = parseFloat(r.gram) || 0; 
      const hargaBeliVarian = parseFloat(b.harga) || 0;
      if (kapasitasVarian > 0) {
        return a + (hargaBeliVarian / kapasitasVarian);
      }
      return a;
    }, 0);

    const modalTopingTambahan = (menu.resepToping || []).reduce((a, t) => a + (parseFloat(t.harga) || 0), 0);
    return Math.ceil(modalPokokPerPcs + modalVarianPerPcs + modalTopingTambahan);
  };

  function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);

    const doLogin = async () => {
      setErr("");
      const u = String(username || "").trim();
      if (!u || !password) { 
        setErr("Masukkan nama user/email dan password."); 
        return; 
      }
      try {
        setBusy(true);
        const emailFormat = u.includes("@") ? u : `${u.toLowerCase()}@donatboss.local`;
        const { error } = await sb.auth.signInWithPassword({ email: emailFormat, password: password });
        if (error) throw error;
      } catch (ex) { 
        setErr(ex?.message || String(ex)); 
      } finally { 
        setBusy(false); 
      }
    };

    return React.createElement("div", { className: "login-wrap" }, 
      React.createElement("div", { className: "login-card" }, 
        React.createElement("div", { style: { fontSize: 52, textAlign: "center" } }, "EVORA"), 
        React.createElement("h1", { className: "login-title" }, "DONAT"), 
        React.createElement("p", { className: "login-sub" }, "Masuk privat menggunakan Kata Sandi tanpa tautan email."), 
        React.createElement("div", { className: "field-group" }, 
          React.createElement("label", null, "Nama User / Username / Email"), 
          React.createElement("input", { className: "inp", value: username, onChange: (e) => setUsername(e.target.value), onKeyDown: (e) => e.key === "Enter" && doLogin(), placeholder: "Ketik nama user atau email..." })
        ), 
        React.createElement("div", { className: "field-group", style: { marginTop: 8 } }, 
          React.createElement("label", null, "Kata Sandi (Password)"), 
          // FIX BUG UTAMA: Menambahkan fungsi onChange agar sandi bisa diketik lancar kembali
          React.createElement("input", { className: "inp", type: "password", value: password, onChange: (e) => setPassword(e.target.value), onKeyDown: (e) => e.key === "Enter" && doLogin(), placeholder: "Masukkan kata sandi..." })
        ), 
        err && React.createElement("p", { style: { color: "#ef4444", fontSize: 13, marginTop: 4 } }, err), 
        React.createElement("button", { className: "btn-primary btn-full", onClick: doLogin, disabled: busy, style: { marginTop: 12 } }, busy ? "Memverifikasi..." : "Masuk")
      )
    );
  }

  function WorkerPage({ pushNotif, me, mode = "worker" }) {
    const tick = useStoreTick();
    const [tab, setTab] = useState(() => localStorage.getItem("evora_tab") || "kasir");
    
    const [cart, setCart] = useState(() => { 
      try { 
        const saved = localStorage.getItem("evora_cart"); 
        if (!saved) return [];
        const parsed = JSON.parse(saved); 
        return Array.isArray(parsed) ? parsed : []; 
      } catch (e) { return []; } 
    });
    
    const [customAbsDate, setCustomAbsDate] = useState(today());

    useEffect(() => { localStorage.setItem("evora_tab", tab); }, [tab]);
    useEffect(() => { localStorage.setItem("evora_cart", JSON.stringify(cart)); }, [cart]);

    const [branches, setBranches] = useState(() => S.get("branches") || []);
    const [branchId, setBranchId] = useState(() => me?.branchId || (S.get("branches") || [{}])[0]?.id || "");
    const [menus, setMenus] = useState(() => S.get("menuVarian") || []);
    const [topings, setTopings] = useState(() => S.get("topingTambahan") || []);
    const [txDate, setTxDate] = useState(today());
    const [editModal, setEditModal] = useState(null);
    const userId = me?.user_id;

    useEffect(() => {
      setBranches(S.get("branches") || []);
      setMenus(S.get("menuVarian") || []);
      setTopings(S.get("topingTambahan") || []);
      if (me?.branchId) setBranchId(me.branchId);
    }, [tick, me?.branchId]);

    const curBranch = branches.find((b) => b.id === branchId);
    const transactions = (S.get("transactions") || []).filter((t) => t.branchId === branchId && t.date === txDate);
    const branchOmzet = transactions.reduce((a, t) => a + t.total, 0);
    const branchPeng = (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date === txDate).reduce((a, p) => a + p.jumlah, 0);

    const addToCart = (menu) => setCart((c) => {
      const ex = c.find((x) => x.menuId === menu.id);
      if (ex) return c.map((x) => x.menuId === menu.id ? { ...x, qty: x.qty + 1 } : x);
      
      let hppTotalItem = hitungHPP(menu);
      if (menu.tipe === "paket") {
        const isiPcs = parseInt(menu.isiBox) || 1;
        const modalBoxCasing = parseFloat(menu.hargaBoxCasing) || 0;
        hppTotalItem = (hitungHPP({ tipe: "satuan" }) * isiPcs) + modalBoxCasing;
      }

      return [...c, { id: uid(), menuId: menu.id, topingId: null, nama: menu.nama, tipe: menu.tipe || "satuan", isiBox: menu.isiBox || null, hargaJual: menu.hargaJual, hpp: hppTotalItem, qty: 1 }];
    });
    
    const addToping = (tp) => setCart((c) => {
      const ex = c.find((x) => x.topingId === tp.id);
      if (ex) return c.map((x) => x.topingId === tp.id ? { ...x, qty: x.qty + 1 } : x);
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
      
      setCart([]); 
      localStorage.removeItem("evora_cart");
      pushNotif("Transaksi disimpan!", "success");
    };

    const saveEdit = (txId, newItems, alasan) => {
      const txs = S.get("transactions") || [];
      const old = txs.find((x) => x.id === txId);
      S.set("transactions", txs.map((t) => t.id === txId ? { ...t, items: newItems, total: newItems.reduce((a, x) => a + x.hargaJual * x.qty, 0), totalHPP: newItems.reduce((a, x) => a + x.hpp * x.qty, 0), edited: true } : t));
      const logs = S.get("editLog") || [];
      S.set("editLog", [...logs, { id: uid(), ts: nowTs(), txId, branchId, branchName: curBranch?.name || branchId, alasan, before: old?.items || [], after: newItems }]);
      setEditModal(null); pushNotif("Transaksi diperbarui.", "warning");
    };

    const getSetoran = useCallback(() => {
      const s = S.get("setoranHarian") || [];
      return s.find((x) => x.branchId === branchId && x.date === txDate) || { status: "belum" };
    }, [branchId, txDate]);
    
    const [setoran, setSetoran] = useState(getSetoran);
    useEffect(() => setSetoran(getSetoran()), [getSetoran]);

    const doSetoran = () => {
      const s = S.get("setoranHarian") || [];
      const existing = s.find((x) => x.branchId === branchId && x.date === txDate);
      const entry = { id: existing?.id || uid(), branchId, branchName: curBranch?.name || branchId, date: txDate, ts: nowTs(), status: "menunggu", omzet: branchOmzet, pengeluaran: branchPeng };
      S.set("setoranHarian", existing ? s.map((x) => x.id === entry.id ? entry : x) : [...s, entry]);
      setSetoran(entry); pushNotif("Setoran dikirim!", "success");
    };

    const allowSetoran = mode === "worker";
    const TABS = allowSetoran ? ["kasir", "riwayat", "pengeluaran", "setoran", "absensi"] : ["kasir", "riwayat", "pengeluaran", "absensi"];
    const TAB_LABELS = { kasir: "Kasir", riwayat: "Riwayat", pengeluaran: "Pengeluaran", setoran: "Setoran", absensi: "Absensi" };

    const [absMonth, setAbsMonth] = useState(today().slice(0, 7));
    
    const currentSelectedAbs = useMemo(() => {
      const all = S.get("absensi") || []; 
      return all.find((a) => a.user_id === userId && a.date === customAbsDate) || null;
    }, [tick, userId, customAbsDate]);

    const doCheckin = () => {
      if (!userId) return;
      
      const dObj = new Date(customAbsDate);
      const namaHariTerpilih = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][dObj.getDay()];
      
      const jadwalLibur = S.get("jadwalLibur") || {};
      const liburKu = jadwalLibur[userId];
      
      if (liburKu && liburKu === namaHariTerpilih) {
        alert(`Akses ditolak!\n\nTanggal ${customAbsDate} adalah hari ${namaHariTerpilih} (Jadwal Libur Anda). Sistem memblokir absensi.`);
        return;
      }
      
      const all = S.get("absensi") || [];
      const ex = all.find((a) => a.user_id === userId && a.date === customAbsDate);
      if (ex?.checkin_ts) { pushNotif("Data check-in untuk tanggal ini sudah ada.", "warning"); return; }
      
      const row = { id: uid(), user_id: userId, branchId: me?.branchId || branchId, date: customAbsDate, checkin_ts: customAbsDate + " 08:00:00", checkout_ts: null };
      S.set("absensi", [...all, row]);
      pushNotif("Check-in tanggal " + customAbsDate + " disimpan.", "success");
    };

    const doCheckout = () => {
      if (!userId) return;
      const all = S.get("absensi") || [];
      const ex = all.find((a) => a.user_id === userId && a.date === customAbsDate);
      if (!ex?.checkin_ts) { pushNotif("Belum ada data Check-in untuk tanggal ini.", "warning"); return; }
      if (ex?.checkout_ts) { pushNotif("Sudah melakukan check-out untuk tanggal ini.", "warning"); return; }
      
      const row = { ...ex, checkout_ts: customAbsDate + " 17:00:00" };
      S.set("absensi", all.map((a) => a.id === row.id ? row : a));
      pushNotif("Check-out tanggal " + customAbsDate + " disimpan.", "success");
    };

    const myMonthRows = useMemo(() => {
      const all = S.get("absensi") || []; return all.filter((a) => a.user_id === userId && String(a.date || "").startsWith(absMonth));
    }, [tick, userId, absMonth]);

    const monthSnap = useMemo(() => {
      const snaps = S.get("absensiBulanan") || []; return snaps.find((s) => s.user_id === userId && s.bulan === absMonth && s.locked) || null;
    }, [tick, userId, absMonth]);

    const calcMonth = useMemo(() => {
      let hadir = 0; let menit = 0;
      for (const r of myMonthRows) {
        if (r.checkin_ts) hadir += 1;
      }
      return { hadir, menit };
    }, [myMonthRows]);

    return React.createElement("div", { className: "page" }, 
      React.createElement("div", { className: "page-header" }, 
        React.createElement("img", { className: "page-icon", src: "./logo.jpg", style: { width: 45, height: 45, objectFit: "cover", borderRadius: 10, padding: 0 } }), 
        React.createElement("div", null, 
          React.createElement("h2", null, "Halaman Kasir"), 
          React.createElement("p", { className: "page-sub" }, curBranch?.name || "\u2014", curBranch?.workers?.length ? " - " + curBranch.workers.join(", ") : "")
        )
      ), 
      React.createElement("div", { className: "row-wrap mb8" }, 
        React.createElement("select", { className: "inp inp-sm", value: branchId, onChange: (e) => setBranchId(e.target.value), disabled: !!me?.branchId }, branches.map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name))), 
        React.createElement("input", { type: "date", className: "inp inp-sm", value: txDate, onChange: (e) => setTxDate(e.target.value) })
      ), 
      React.createElement("div", { className: "tabs" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TAB_LABELS[t]))), 
      
      tab === "kasir" && React.createElement("div", { className: "kasir-layout" }, 
        React.createElement("div", null, 
          React.createElement("h3", { className: "section-title" }, "Menu Satuan"), 
          React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe !== "paket").map((m) => React.createElement("button", { key: m.id, className: "menu-card", onClick: () => addToCart(m), style: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" } }, m.imgUrl ? React.createElement("img", { src: m.imgUrl, style: { width: "100%", height: "90px", objectFit: "cover" } }) : React.createElement("div", { style: { width: "100%", height: "90px", background: "#f1f5f9", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 } }, "Tanpa Foto"), React.createElement("div", { style: { padding: "8px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", boxSizing: "border-box" } }, React.createElement("div", { className: "menu-name", style: { textAlign: "center" } }, m.nama), React.createElement("div", { className: "menu-price", style: { textAlign: "center" } }, fmtRp(m.hargaJual)))))), 
          React.createElement("h3", { className: "section-title mt12" }, "Box / Paket"), 
          React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe === "paket").map((m) => React.createElement("button", { key: m.id, className: "menu-card menu-card-paket", onClick: () => addToCart(m), style: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" } }, m.imgUrl ? React.createElement("img", { src: m.imgUrl, style: { width: "100%", height: "90px", objectFit: "cover" } }) : React.createElement("div", { style: { width: "100%", height: "90px", background: "#f1f5f9", color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 } }, "Tanpa Foto"), React.createElement("div", { style: { padding: "8px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", boxSizing: "border-box" } }, React.createElement("div", { className: "menu-name", style: { textAlign: "center" } }, m.nama), React.createElement("div", { style: { fontSize: 11, opacity: 0.7, textAlign: "center" } }, "Isi ", m.isiBox, " pcs"), React.createElement("div", { className: "menu-price", style: { textAlign: "center" } }, fmtRp(m.hargaJual)))))), 
          React.createElement("h3", { className: "section-title mt12" }, "Toping Tambahan"), 
          React.createElement("div", { className: "menu-grid" }, topings.map((t) => React.createElement("button", { key: t.id, className: "menu-card menu-card-toping", onClick: () => addToping(t) }, React.createElement("div", { className: "menu-name" }, t.nama), React.createElement("div", { className: "menu-price" }, fmtRp(t.hargaJual)))))
        ), 
        React.createElement("div", { className: "cart-section" }, 
          React.createElement("h3", { className: "section-title" }, "Keranjang"), 
          cart.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada item"), 
          cart.map((item) => React.createElement("div", { key: item.id, className: "cart-item" }, React.createElement("div", { className: "cart-item-info" }, React.createElement("span", null, item.nama), React.createElement("span", { className: "cart-qty" }, "x", item.qty)), React.createElement("div", { className: "cart-item-right" }, React.createElement("span", null, fmtRp(item.hargaJual * item.qty)), React.createElement("button", { className: "btn-danger-sm", onClick: () => removeCart(item.id) }, "X")))), 
          cart.length > 0 && React.createElement(React.Fragment, null, 
            React.createElement("div", { className: "cart-total" }, "Total: ", React.createElement("strong", null, fmtRp(totalBayar))), 
            React.createElement("div", { className: "row-wrap" }, React.createElement("button", { className: "btn-secondary", onClick: () => { setCart([]); localStorage.removeItem("evora_cart"); } }, "Batal"), React.createElement("button", { className: "btn-primary", onClick: submitTx }, "Simpan Transaksi"))
          ), 
          React.createElement("div", { className: "omzet-box mt12" }, React.createElement("span", null, "Omzet Hari Ini"), React.createElement("strong", null, fmtRp(branchOmzet))), 
          React.createElement("div", { className: "omzet-box", style: { borderColor: "#5a1a1a" } }, React.createElement("span", null, "Pengeluaran"), React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(branchPeng)))
        )
      ), 
      
      tab === "riwayat" && React.createElement("div", null, 
        React.createElement("h3", { className: "section-title" }, "Riwayat - ", txDate), 
        transactions.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada transaksi"), 
        [...transactions].reverse().map((tx) => React.createElement("div", { key: tx.id, className: "tx-card" + (tx.edited ? " tx-edited" : "") }, React.createElement("div", { className: "tx-header" }, React.createElement("span", { className: "tx-id" }, "STRUK-", tx.id.slice(0, 6).toUpperCase()), React.createElement("span", { className: "tx-ts" }, tx.ts), tx.edited && React.createElement("span", { className: "badge-edit" }, "Diedit")), tx.items.map((it, i) => React.createElement("div", { key: i, className: "tx-item" }, it.nama, " x", it.qty, " - ", fmtRp(it.hargaJual * it.qty))), React.createElement("div", { className: "tx-total" }, "Total: ", fmtRp(tx.total)), React.createElement("button", { className: "btn-edit-sm", onClick: () => setEditModal(tx) }, "Edit")))
      ), 
      
      tab === "pengeluaran" && React.createElement(PengeluaranLapak, { branchId, branchName: curBranch?.name || "", date: txDate, pushNotif }), 
      
      allowSetoran && tab === "setoran" && React.createElement("div", { className: "setoran-box-worker" }, 
        React.createElement("div", { className: "setoran-status setoran-" + setoran.status }, React.createElement("span", null, setoran.status === "belum" ? "Belum Setor" : setoran.status === "menunggu" ? "Menunggu Konfirmasi Owner" : "Sudah Setor - Dikonfirmasi")), 
        React.createElement("div", { className: "setoran-omzet" }, "Omzet: ", React.createElement("strong", null, fmtRp(branchOmzet))), 
        React.createElement("div", { className: "setoran-omzet" }, "Pengeluaran Lapak: ", React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(branchPeng))), 
        React.createElement("div", { className: "setoran-omzet" }, "Bersih Disetor: ", React.createElement("strong", { style: { color: "#22c55e" } }, fmtRp(branchOmzet - branchPeng))), 
        setoran.status === "belum" && React.createElement("button", { className: "btn-primary btn-full", onClick: doSetoran }, "Setor Sekarang")
      ), 
      
      tab === "absensi" && React.createElement("div", null, 
        React.createElement("h3", { className: "section-title mt8" }, "Pencatatan Absensi Harian Luar Jaringan (6 Bulan Ini)"), 
        React.createElement("div", { className: "form-card" }, 
          React.createElement("div", { className: "field-group" }, 
            React.createElement("label", null, "Pilih Tanggal Absen Yang Ingin Dimasukkan:"),
            React.createElement("input", { type: "date", className: "inp", value: customAbsDate, onChange: (e) => setCustomAbsDate(e.target.value) })
          ),
          React.createElement("div", { className: "row-wrap", style: { justifyContent: "space-between", marginTop: 8 } }, 
            React.createElement("div", null, 
              React.createElement("div", { style: { fontWeight: 700 } }, "Status Data Terpilih:"), 
              React.createElement("div", { style: { fontSize: 12, color: "#9a9690" } }, "Check-in: ", currentSelectedAbs?.checkin_ts ? "Ada Data" : "-", " | Check-out: ", currentSelectedAbs?.checkout_ts ? "Ada Data" : "-")
            ), 
            React.createElement("div", { className: "row-wrap" }, 
              React.createElement("button", { className: "btn-primary btn-sm", onClick: doCheckin }, "Input Check-in"), 
              React.createElement("button", { className: "btn-secondary btn-sm", onClick: doCheckout }, "Input Check-out")
            )
          )
        ), 
        React.createElement("div", { className: "field-group mt8" }, React.createElement("label", null, "Rekap Grafik Bulanan"), React.createElement("input", { type: "month", className: "inp inp-sm", value: absMonth, onChange: (e) => setAbsMonth(e.target.value) })), 
        React.createElement("div", { className: "kpi-grid" }, 
          React.createElement("div", { className: "kpi-card kpi-omzet" }, React.createElement("div", { className: "kpi-label" }, "Total Hadir"), React.createElement("div", { className: "kpi-val" }, (monthSnap ? monthSnap.total_hadir : calcMonth.hadir), " hari")), 
          React.createElement("div", { className: "kpi-card kpi-profit" }, React.createElement("div", { className: "kpi-label" }, "Total Jam"), React.createElement("div", { className: "kpi-val" }, Math.round(((monthSnap ? monthSnap.total_menit : calcMonth.menit) || 0) / 60 * 10) / 10, " jam"))
        ), 
        React.createElement("h3", { className: "section-title mt12" }, "Riwayat Absensi Terdaftar (", absMonth, ")"), 
        myMonthRows.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada absensi."), 
        [...myMonthRows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((r) => React.createElement("div", { key: r.id, className: "peng-row" }, React.createElement("div", { className: "peng-info" }, React.createElement("span", { className: "peng-ket" }, r.date), React.createElement("span", { className: "peng-ts" }, "In: ", fmtTs(r.checkin_ts), " | Out: ", fmtTs(r.checkout_ts)))))
      ), 
      editModal && React.createElement(EditTxModal, { tx: editModal, onClose: () => setEditModal(null), onSave: saveEdit })
    );
  }

  function PengeluaranLapak({ branchId, branchName, date, pushNotif }) {
    const getList = () => (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date === date);
    const [list, setList] = useState(getList);
    const [form, setForm] = useState({ keterangan: "", jumlah: "" });
    const refresh = () => setList(getList());
    const CHIPS = ["Kantong Plastik", "Distribusi", "Transportasi", "Tisu", "Kemasan", "Lain-lain"];
    
    const tambah = () => {
      if (!form.keterangan || !form.jumlah) { alert("Isi semua kolom!"); return; }
      const all = S.get("pengeluaranLapak") || [];
      S.set("pengeluaranLapak", [...all, { id: uid(), branchId, branchName, date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah) }]);
      setForm({ keterangan: "", jumlah: "" }); refresh(); pushNotif("Pengeluaran dicatat!", "success");
    };
    
    const hapus = (id) => { S.set("pengeluaranLapak", (S.get("pengeluaranLapak") || []).filter((x) => x.id !== id)); refresh(); };
    const total = list.reduce((a, p) => a + p.jumlah, 0);
    
    return React.createElement("div", null, 
      React.createElement("h3", { className: "section-title" }, "Pengeluaran Lapak - ", date), 
      React.createElement("div", { className: "chips mt8" }, CHIPS.map((s) => React.createElement("button", { key: s, className: "chip", onClick: () => setForm((f) => ({ ...f, keterangan: s })) }, s))), 
      React.createElement("div", { className: "form-card mt8" }, 
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Keterangan"), React.createElement("input", { className: "inp", value: form.keterangan, onChange: (e) => setForm((f) => ({ ...f, keterangan: e.target.value })), placeholder: "Keterangan..." })), 
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Jumlah (Rp)"), React.createElement("input", { className: "inp", type: "number", value: form.jumlah, onChange: (e) => setForm((f) => ({ ...f, jumlah: e.target.value })) })), 
        React.createElement("button", { className: "btn-primary", onClick: tambah }, "+ Tambah")
      ), 
      list.length === 0 && React.createElement("p", { className: "empty-txt mt8" }, "Belum ada pengeluaran hari ini"), 
      list.length > 0 && React.createElement("div", { className: "mt8" }, list.map((p) => React.createElement("div", { key: p.id, className: "peng-row" }, React.createElement("div", { className: "peng-info" }, React.createElement("span", { className: "peng-ket" }, p.keterangan), React.createElement("span", { className: "peng-ts" }, p.ts)), React.createElement("div", { className: "peng-right" }, React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah)), React.createElement("button", { className: "btn-danger-sm", onClick: () => hapus(p.id) }, "X"))))), React.createElement("div", { className: "peng-total" }, "Total: ", React.createElement("strong", null, fmtRp(total)))
    );
  }

  function EditTxModal({ tx, onClose, onSave }) {
    const [items, setItems] = useState(tx.items.map((x) => ({ ...x })));
    const [alasan, setAlasan] = useState("");
    const changeQty = (id, qty) => {
      if (qty <= 0) { setItems((i) => i.filter((x) => x.id !== id)); return; }
      setItems((i) => i.map((x) => x.id === id ? { ...x, qty } : x));
    };
    return React.createElement(Modal, { title: "Edit Transaksi", onClose }, 
      React.createElement("div", { className: "field-group mt8" }, React.createElement("label", null, "Alasan Edit"), React.createElement("input", { className: "inp", value: alasan, onChange: (e) => setAlasan(e.target.value) })), 
      React.createElement("div", { className: "row-wrap mt8" }, React.createElement("button", { className: "btn-secondary", onClick: onClose }, "Batal"), React.createElement("button", { className: "btn-primary", onClick: () => { if (!alasan.trim()) { alert("Wajib isi alasan!"); return; } onSave(tx.id, items, alasan); } }, "Simpan"))
    );
  }

  function OwnerPage({ pushNotif, me }) {
    const tick = useStoreTick();
    const [tab, setTab] = useState("dashboard");
    const [stab, setStab] = useState("hpp");
    
    useEffect(() => {
      const iv = setInterval(() => {
        const list = S.get("setoranHarian") || [];
        const pending = list.filter((s) => s.status === "menunggu");
        if (pending.length) {
          const noted = S.get("notified_ids");
          const safeNoted = Array.isArray(noted) ? noted : [];
          const fresh = pending.filter((s) => !safeNoted.includes(s.id));
          if (fresh.length) {
            pushNotif(fresh.length + " setoran menunggu konfirmasi!", "warning");
            S.set("notified_ids", [...safeNoted, ...fresh.map((s) => s.id)]);
          }
        }
      }, 5000);
      return () => clearInterval(iv);
    }, [pushNotif]);
    
    const TABS = ["dashboard", "kasir", "setoran", "laporan", "absensi", "pengeluaran", "setting"];
    const TLABEL = { dashboard: "Dashboard", kasir: "Kasir", setoran: "Setoran", laporan: "Laporan", absensi: "Absensi", pengeluaran: "Pengeluaran", setting: "Seting" };
    
    return React.createElement("div", { className: "page" }, 
      React.createElement("div", { className: "page-header" }, 
        React.createElement("img", { className: "page-icon", src: "./logo.jpg", style: { width: 45, height: 45, objectFit: "cover", borderRadius: 10, padding: 0 } }), 
        React.createElement("div", null, React.createElement("h2", null, "Panel Owner"), React.createElement("p", { className: "page-sub" }, "Kontrol penuh bisnis Anda"))
      ), 
      React.createElement("div", { className: "tabs tabs-scroll" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TLABEL[t]))), 
      tab === "dashboard" && React.createElement(OwnerDashboard, null), 
      tab === "kasir" && React.createElement(WorkerPage, { pushNotif, me, mode: "owner" }), 
      tab === "setoran" && React.createElement(OwnerSetoran, { pushNotif }), 
      tab === "laporan" && React.createElement(OwnerLaporan, null), 
      tab === "absensi" && React.createElement(OwnerAbsensi, { pushNotif }), 
      tab === "pengeluaran" && React.createElement(PengeluaranOwner, { pushNotif }), 
      tab === "setting" && React.createElement(OwnerSetting, { stab, setStab, pushNotif })
    );
  }

  function OwnerDashboard() {
    const [dr, setDr] = useState({ from: today(), to: today() });
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const txs = S.get("transactions") || [];
    const pL = S.get("pengeluaranLapak") || [];
    const pO = S.get("pengeluaranOwner") || [];
    const fTxs = txs.filter((t) => t.date >= dr.from && t.date <= dr.to && (selBranch === "all" || t.branchId === selBranch));
    const fPL = pL.filter((p) => p.date >= dr.from && p.date <= dr.to && (selBranch === "all" || p.branchId === selBranch));
    const fPO = pO.filter((p) => p.date >= dr.from && p.date <= dr.to && (selBranch === "all" || p.branchId === selBranch));
    
    const omzet = fTxs.reduce((a, t) => a + t.total, 0);
    const modal = fTxs.reduce((a, t) => a + t.totalHPP, 0);
    const peng = fPL.reduce((a, p) => a + p.jumlah, 0) + fPO.reduce((a, p) => a + p.jumlah, 0);
    const laba = omzet - modal - peng;
    
    const branchStats = branches.map((b) => {
      const bTx = fTxs.filter((t) => t.branchId === b.id);
      const bPL = fPL.filter((p) => p.branchId === b.id).reduce((a, p) => a + p.jumlah, 0) + fPO.filter((p) => p.branchId === b.id).reduce((a, p) => a + p.jumlah, 0);
      const bO = bTx.reduce((a, t) => a + t.total, 0);
      const bM = bTx.reduce((a, t) => a + t.totalHPP, 0);
      return { ...b, omzet: bO, modal: bM, peng: bPL, laba: bO - bM - bPL, txCount: bTx.length };
    });
    
    const mc = {};
    fTxs.forEach((t) => t.items.forEach((it) => { mc[it.nama] = (mc[it.nama] || 0) + it.qty; }));
    const bs = Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    const chart7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); const ds = d.toISOString().slice(0, 10);
      const dO = txs.filter((t) => t.date === ds).reduce((a, t) => a + t.total, 0);
      const dP = pL.filter((p) => p.date === ds).reduce((a, p) => a + p.jumlah, 0) + pO.filter((p) => p.date === ds).reduce((a, p) => a + p.jumlah, 0);
      const dM = txs.filter((t) => t.date === ds).reduce((a, t) => a + t.totalHPP, 0);
      chart7.push({ label: ds.slice(5), v1: dO, v2: dM + dP });
    }
    const branchChart = branchStats.map((b) => ({ label: b.name.slice(0, 8), v1: b.omzet, v2: b.laba }));
    
    return React.createElement("div", null, 
      React.createElement("div", { className: "filter-bar mb8" }, React.createElement("input", { type: "date", className: "inp inp-sm", value: dr.from, onChange: (e) => setDr((r) => ({ ...r, from: e.target.value })) }), React.createElement("span", null, "s/d"), React.createElement("input", { type: "date", className: "inp inp-sm", value: dr.to, onChange: (e) => setDr((r) => ({ ...r, to: e.target.value })) }), React.createElement("select", { className: "inp inp-sm", value: selBranch, onChange: (e) => setSelBranch(e.target.value) }, React.createElement("option", { value: "all" }, "Semua Cabang"), branches.map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name)))), 
      React.createElement("div", { className: "kpi-grid" }, 
        React.createElement("div", { className: "kpi-card kpi-omzet" }, React.createElement("div", { className: "kpi-label" }, "Omzet"), React.createElement("div", { className: "kpi-val" }, fmtRp(omzet))), 
        React.createElement("div", { className: "kpi-card kpi-modal" }, React.createElement("div", { className: "kpi-label" }, "HPP Bahan"), React.createElement("div", { className: "kpi-val" }, fmtRp(modal))), 
        React.createElement("div", { className: "kpi-card kpi-peng" }, React.createElement("div", { className: "kpi-label" }, "Pengeluaran"), React.createElement("div", { className: "kpi-val" }, fmtRp(peng))), 
        React.createElement("div", { className: "kpi-card kpi-profit" }, React.createElement("div", { className: "kpi-label" }, "Laba Bersih"), React.createElement("div", { className: "kpi-val" }, fmtRp(laba))), 
        React.createElement("div", { className: "kpi-card kpi-tx" }, React.createElement("div", { className: "kpi-label" }, "Transaksi"), React.createElement("div", { className: "kpi-val" }, fTxs.length, "x")), 
        React.createElement("div", { className: "kpi-card kpi-cab" }, React.createElement("div", { className: "kpi-label" }, "Cabang"), React.createElement("div", { className: "kpi-val" }, branches.length))
      ), 
      React.createElement("div", { className: "two-col mt12" }, 
        React.createElement("div", { className: "chart-box" }, React.createElement("h3", { className: "section-title" }, "Omzet vs Pengeluaran - 7 Hari"), React.createElement(BarChart, { data: chart7, height: 100 })), 
        React.createElement("div", { className: "chart-box" }, React.createElement("h3", { className: "section-title" }, "Omzet Per Cabang"), React.createElement(BarChart, { data: branchChart, height: 100 }))
      ), 
      React.createElement("div", { className: "two-col mt12" }, 
        React.createElement("div", null, React.createElement("h3", { className: "section-title" }, "Performa Cabang"), branchStats.map((b) => React.createElement("div", { key: b.id, className: "branch-stat-card" }, React.createElement("div", { className: "branch-stat-name" }, b.name), React.createElement("div", { className: "branch-stat-row" }, React.createElement("span", null, "Omzet"), React.createElement("strong", null, fmtRp(b.omzet))), React.createElement("div", { className: "branch-stat-row" }, React.createElement("span", null, "Laba"), React.createElement("strong", { style: { color: "#22c55e" } }, fmtRp(b.laba)))))), 
        React.createElement("div", null, React.createElement("h3", { className: "section-title" }, "Best Seller"), bs.length === 0 && React.createElement("p", { className: "empty-txt" }, "Belum ada data"), bs.map(([nama, qty], i) => React.createElement("div", { key: i, className: "bestseller-row" }, React.createElement("span", { className: "bs-rank" }, "#", i + 1), React.createElement("span", { className: "bs-nama" }, nama), React.createElement("span", { className: "bs-qty" }, qty, " pcs"))))
      )
    );
  }

  function PengeluaranOwner({ pushNotif }) {
    const [date, setDate] = useState(today());
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const getList = () => S.get("pengeluaranOwner") || [];
    const [list, setList] = useState(getList);
    const [form, setForm] = useState({ keterangan: "", jumlah: "", kategori: "gaji_pekerja", targetBranchId: "" });
    const refresh = () => setList(getList());
    
    const KATEGORI = [
      { value: "gaji_pekerja", label: "Gaji Pekerja Lapak" }, 
      { value: "gaji_kitchen", label: "Gaji Central Kitchen" },
      { value: "bahan_baku", label: "Bahan Baku" }, 
      { value: "operasional", label: "Operasional" },
      { value: "lainnya", label: "Lainnya" }
    ];
    
    const tambah = () => {
      if (!form.keterangan || !form.jumlah || !form.targetBranchId) { alert("Isi semua kolom termasuk penempatan Cabang!"); return; }
      S.set("pengeluaranOwner", [...S.get("pengeluaranOwner") || [], { id: uid(), date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah), kategori: form.kategori, branchId: form.targetBranchId }]);
      setForm((f) => ({ ...f, keterangan: "", jumlah: "" })); refresh(); pushNotif("Pengeluaran pusat dicatat!", "success");
    };
    
    const hapus = (id) => { S.set("pengeluaranOwner", (S.get("pengeluaranOwner") || []).filter((x) => x.id !== id)); refresh(); };
    const filtered = list.filter((p) => p.date === date && (selBranch === "all" || p.branchId === selBranch));
    
    return React.createElement("div", null, 
      React.createElement("div", { className: "filter-bar mb8" }, 
        React.createElement("input", { type: "date", className: "inp inp-sm", value: date, onChange: (e) => setDate(e.target.value) }),
        React.createElement("select", { className: "inp inp-sm", value: selBranch, onChange: (e) => setSelBranch(e.target.value) },
          React.createElement("option", { value: "all" }, "Semua Penempatan Cabang"),
          branches.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))
        )
      ), 
      React.createElement("div", { className: "form-card" }, 
        React.createElement("h4", null, "Tambah Pengeluaran Pusat Per Cabang"), 
        React.createElement("div", { className: "field-group" }, 
          React.createElement("label", null, "Pilih Alokasi Cabang:"),
          React.createElement("select", { className: "inp", value: form.targetBranchId, onChange: (e) => setForm({ ...form, targetBranchId: e.target.value }) },
            React.createElement("option", { value: "" }, "-- Pilih Cabang --"),
            branches.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))
          )
        ),
        React.createElement("div", { className: "field-group" }, 
          React.createElement("label", null, "Kategori"), 
          React.createElement("select", { className: "inp", value: form.kategori, onChange: (e) => setForm({ ...form, kategori: e.target.value }) }, KATEGORI.map((k) => React.createElement("option", { key: k.value, value: k.value }, k.label)))
        ), 
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Keterangan"), React.createElement("input", { className: "inp", value: form.keterangan, onChange: (e) => setForm({ ...form, keterangan: e.target.value }), placeholder: "Detail pengeluaran..." })), 
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Jumlah (Rp)"), 
          // FIX BUG KEDUA: Menambahkan onChange untuk input jumlah agar form alokasi operasional owner bisa diketik nominal uangnya
          React.createElement("input", { className: "inp", type: "number", value: form.jumlah, onChange: (e) => setForm({ ...form, jumlah: e.target.value }) })), 
        React.createElement("button", { className: "btn-primary", onClick: tambah }, "+ Simpan Pengeluaran")
      ), 
      React.createElement("h3", { className: "section-title mt8" }, "Daftar Biaya Terdistribusi"), 
      filtered.map((p) => React.createElement("div", { key: p.id, className: "peng-row" }, 
        React.createElement("div", { className: "peng-info" }, 
          React.createElement("span", { className: "peng-ket" }, p.keterangan), 
          React.createElement("span", { className: "peng-ts" }, "Alokasi: ", branches.find(b => b.id === p.branchId)?.name || "Global")
        ), 
        React.createElement("div", { className: "peng-right" }, React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah)), React.createElement("button", { className: "btn-danger-sm", onClick: () => hapus(p.id) }, "X"))
      ))
    );
  }

  function OwnerSetoran({ pushNotif }) {
    const [tab, setTab] = useState("harian");
    const [sH, setSH] = useState(() => S.get("setoranHarian") || []);
    const branches = S.get("branches") || [];
    const refresh = () => { setSH(S.get("setoranHarian") || []); };
    const konfirmasi = (id) => {
      S.set("setoranHarian", (S.get("setoranHarian") || []).map((s) => s.id === id ? { ...s, status: "selesai", konfirmasiTs: nowTs() } : s));
      refresh(); pushNotif("Setoran dikonfirmasi!", "success");
    };
    
    return React.createElement("div", null, 
      React.createElement("div", { className: "tabs" }, React.createElement("button", { className: "tab" + (tab === "harian" ? " active" : ""), onClick: () => setTab("harian") }, "Harian (Pekerja ke Owner)")), 
      tab === "harian" && React.createElement("div", null, [...sH].reverse().map((s) => {
        const b = branches.find((x) => x.id === s.branchId);
        return React.createElement("div", { key: s.id, className: "setoran-card" }, React.createElement("div", { className: "setoran-card-header" }, React.createElement("span", null, b?.name || s.branchName), React.createElement("span", null, s.date)), React.createElement("div", { className: "setoran-card-status" }, s.status === "menunggu" && React.createElement("button", { className: "btn-primary btn-sm", onClick: () => konfirmasi(s.id) }, "Konfirmasi")));
      }))
    );
  }

  function OwnerLaporan() {
    const [date, setDate] = useState(today());
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const txs = (S.get("transactions") || []).filter((t) => t.date === date && (selBranch === "all" || t.branchId === selBranch));
    return React.createElement("div", null, 
      React.createElement("div", { className: "filter-bar mb8" }, React.createElement("input", { type: "date", className: "inp inp-sm", value: date, onChange: (e) => setDate(e.target.value) })), 
      React.createElement("h3", { className: "section-title" }, "Struk Omzet Lapak"), 
      txs.map((tx) => React.createElement("div", { key: tx.id, className: "tx-card" }, React.createElement("div", { className: "tx-header" }, React.createElement("span", null, "STRUK-", tx.id.slice(0, 6).toUpperCase())), tx.items.map((it, i) => React.createElement("div", { key: i }, it.nama, " x", it.qty, " = ", fmtRp(it.hargaJual * it.qty)))))
    );
  }

  function OwnerAbsensi({ pushNotif }) {
    const tick = useStoreTick();
    const [month, setMonth] = useState(today().slice(0, 7));
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const profiles = S.get("profiles") || [];
    const absensi = S.get("absensi") || [];
    const workers = profiles.filter((p) => p.role === "worker").filter((p) => selBranch === "all" || p.branchId === selBranch);
    
    const calcUserMonth = useCallback((userId) => {
      const rows2 = absensi.filter((a) => a.user_id === userId && String(a.date || "").startsWith(month));
      let hadir = 0;
      for (const r of rows2) {
        if (r.checkin_ts) hadir += 1;
      }
      rows2.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      return { hadir, history: rows2 };
    }, [absensi, month]);

    const rows = useMemo(() => {
      return workers.map((w) => {
        const calc = calcUserMonth(w.user_id);
        return { w, hadir: calc.hadir, history: calc.history };
      });
    }, [workers, month, calcUserMonth, tick]);

    return React.createElement("div", null, 
      React.createElement("div", { className: "filter-bar mb8" }, React.createElement("input", { type: "month", className: "inp inp-sm", value: month, onChange: (e) => setMonth(e.target.value) })), 
      React.createElement("h3", { className: "section-title" }, "Detail Log Kehadiran Kasir"), 
      rows.map((r) => React.createElement("div", { key: r.w.user_id, className: "peng-row", style: { flexDirection: "column", alignItems: "flex-start" } }, 
        React.createElement("div", { className: "peng-info" }, React.createElement("strong", null, r.w.display_name || r.w.email), React.createElement("span", null, " Total Hadir: ", r.hadir, " hari")), 
        React.createElement("div", { style: { paddingLeft: "8px", borderLeft: "2px solid #555" } }, r.history.map(h => React.createElement("div", { key: h.id, style: { fontSize: "12px", color: "#ccc" } }, "• ", h.date, " : Terdata Hadir dalam Sistem")))
      ))
    );
  }

  function OwnerSetting({ stab, setStab, pushNotif }) {
    const TABS = ["hpp", "paket", "cabang", "akun"];
    const TLABEL = { hpp: "Menu HPP Pokok", paket: "HPP Box/Paket", cabang: "Cabang", akun: "Akun" };
    return React.createElement("div", null, 
      React.createElement("div", { className: "tabs tabs-sm" }, TABS.map((t) => React.createElement("button", { key: t, className: "tab" + (stab === t ? " active" : ""), onClick: () => setStab(t) }, TLABEL[t]))), 
      stab === "hpp" && React.createElement(SettingHPP, { pushNotif }), 
      stab === "paket" && React.createElement(SettingPaket, { pushNotif }), 
      stab === "cabang" && React.createElement(SettingCabang, { pushNotif }), 
      stab === "akun" && React.createElement(SettingAkun, { pushNotif })
    );
  }

  function SettingHPP({ pushNotif }) {
    const [bahan, setBahan] = useState(() => S.get("bahanPokok") || []);
    const [editMenu, setEditMenu] = useState(null);
    const [menus, setMenus] = useState(() => (S.get("menuVarian") || []).filter((m) => m.tipe !== "paket"));
    const [nB, setNB] = useState({ nama: "", satuan: "kg", harga: "", jadiPcs: "" });

    const saveB = () => {
      if (!nB.nama || !nB.harga || !nB.jadiPcs) { alert("All form component is mandatory!"); return; }
      const u = [...bahan, { id: uid(), nama: nB.nama, satuan: nB.satuan, harga: parseFloat(nB.harga), jadiPcs: parseInt(nB.jadiPcs) }];
      S.set("bahanPokok", u); setBahan(u); setNB({ nama: "", satuan: "kg", harga: "", jadiPcs: "" }); pushNotif("Bahan pokok diperbarui!", "success");
    };

    const delB = (id) => { const u = bahan.filter((x) => x.id !== id); S.set("bahanPokok", u); setBahan(u); };
    
    const saveMenu = (m) => {
      const all = S.get("menuVarian") || [];
      const u = all.find((x) => x.id === m.id) ? all.map((x) => x.id === m.id ? m : x) : [...all, { ...m, id: uid() }];
      S.set("menuVarian", u); setMenus(u.filter((x) => x.tipe !== "paket")); setEditMenu(null); pushNotif("Menu disimpan!", "success");
    };

    return React.createElement("div", null, 
      React.createElement("h3", { className: "section-title mt8" }, "Kalkulator Bahan Baku Pokok (Per Kg jadi Berapa Pcs)"), 
      React.createElement("p", { className: "info-txt" }, "Total Modal Pokok Adonan Saat Ini: ", fmtRp(hitungTotalBahanPokokPerPcs()), " / pcs"),
      React.createElement("table", { className: "tbl mt8" }, 
        React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Nama"), React.createElement("th", null, "Harga"), React.createElement("th", null, "Kapasitas"), React.createElement("th", null, "Beban/pcs"))), 
        React.createElement("tbody", null, bahan.map((b) => {
          const bebanPerPcs = (parseFloat(b.harga) || 0) / (parseInt(b.jadiPcs) || 1);
          return React.createElement("tr", { key: b.id }, React.createElement("td", null, b.nama), React.createElement("td", null, fmtRp(b.harga)), React.createElement("td", null, b.jadiPcs, " pcs"), React.createElement("td", null, fmtRp(bebanPerPcs)), React.createElement("td", null, React.createElement("button", { className: "btn-danger-sm", onClick: () => delB(b.id) }, "X")));
        }))
      ), 
      React.createElement("div", { className: "form-card mt8" }, 
        React.createElement("input", { className: "inp mb4", placeholder: "Nama bahan pokok...", value: nB.nama, onChange: (e) => setNB({ ...nB, nama: e.target.value }) }), 
        // FIX BUG KETIGA: Memperbaiki scope pemicu input komponen adonan bahan pokok
        React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Harga Beli Pokok...", value: nB.harga, onChange: (e) => setNB({ ...nB, harga: e.target.value }) }), 
        React.createElement("input", { className: "inp mb4", type: "number", placeholder: "Jadi Berapa Pcs Donat...", value: nB.jadiPcs, onChange: (e) => setNB({ ...nB, jadiPcs: e.target.value }) }), 
        React.createElement("button", { className: "btn-primary btn-full", onClick: saveB }, "Tambah Komponen Pokok")
      ),
      React.createElement("h3", { className: "section-title mt12" }, "Varian Topping Menu Satuan"), 
      menus.map((m) => React.createElement("div", { key: m.id, className: "menu-setting-card" }, 
        React.createElement("div", { className: "menu-setting-row" }, React.createElement("strong", null, m.nama), React.createElement("span", null, " Jual: ", fmtRp(m.hargaJual), " | Total HPP: ", fmtRp(hitungHPP(m)), " | Bati: ", fmtRp(m.hargaJual - hitungHPP(m)))) ,
        React.createElement("button", { className: "btn-secondary btn-sm mt4", onClick: () => setEditMenu({ ...m }) }, "Set Resep Kue Varian")
      )),
      editMenu && React.createElement(EditMenuModal, { menu: editMenu, bahan, onSave: saveMenu, onClose: () => setEditMenu(null) })
    );
  }

  function SettingPaket({ pushNotif }) {
    const [pakets, setPakets] = useState(() => (S.get("menuVarian") || []).filter((m) => m.tipe === "paket"));
    const [editP, setEditP] = useState(null);

    const save = (m) => {
      const all = S.get("menuVarian") || [];
      const u = all.find((x) => x.id === m.id) ? all.map((x) => x.id === m.id ? m : x) : [...all, { ...m, id: uid() }];
      S.set("menuVarian", u); setPakets(u.filter((x) => x.tipe === "paket")); setEditP(null); pushNotif("Paket Kemasan Diperbarui!", "success");
    };

    return React.createElement("div", null, 
      React.createElement("h3", { className: "section-title" }, "Pengaturan Konfigurasi HPP Box Kemasan"), 
      pakets.map((p) => {
        const isiPcs = parseInt(p.isiBox) || 1;
        const hargaCasing = parseFloat(p.hargaBoxCasing) || 0;
        const hppDonatSaja = hitungHPP({ tipe: "satuan" }) * isiPcs;
        const hppTotalBox = hppDonatSaja + hargaCasing;
        const batiBersihBox = (parseFloat(p.hargaJual) || 0) - hppTotalBox;
        
        return React.createElement("div", { key: p.id, className: "menu-setting-card" }, 
          React.createElement("div", { style: { fontSize: 13 } }, 
            React.createElement("strong", null, p.nama), 
            React.createElement("div", null, "Kapasitas Tampung: ", isiPcs, " Pcs Donat Pokok"),
            React.createElement("div", null, "Beban Modal Kardus Box: ", fmtRp(hargaCasing)),
            React.createElement("div", null, "Harga Jual: ", fmtRp(p.hargaJual), " | Total HPP: ", fmtRp(hppTotalBox)),
            React.createElement("div", { style: { color: "#22c55e", fontWeight: "bold" } }, "Nominal Bati Bersih Box: ", fmtRp(batiBersihBox))
          ),
          React.createElement("button", { className: "btn-secondary btn-sm mt4", onClick: () => setEditP({ ...p }) }, "Ubah Settingan Box")
        );
      }),
      React.createElement("button", { className: "btn-primary mt8", onClick: () => setEditP({ id: null, nama: "", tipe: "paket", isiBox: 6, hargaBoxCasing: 2000, hargaJual: 35000 }) }, "+ Tambah Jenis Box Baru"),
      editP && React.createElement(Modal, { title: "Konfigurasi Nilai Box", onClose: () => setEditP(null) }, 
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Nama Box/Paket:"), React.createElement("input", { className: "inp", value: editP.nama, onChange: (e) => setEditP({ ...editP, nama: e.target.value }) })),
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Set Isi Berapa Pcs Per Box:"), React.createElement("input", { className: "inp", type: "number", value: editP.isiBox, onChange: (e) => setEditP({ ...editP, isiBox: e.target.value }) })),
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Tambahan Harga Fisik Box Kemasan (Rp):"), React.createElement("input", { className: "inp", type: "number", value: editP.hargaBoxCasing, onChange: (e) => setEditP({ ...editP, hargaBoxCasing: e.target.value }) })),
        React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Harga Jual Box Jadi (Rp):"), React.createElement("input", { className: "inp", type: "number", value: editP.hargaJual, onChange: (e) => setEditP({ ...editP, hargaJual: e.target.value }) })),
        React.createElement("div", { className: "row-wrap mt8" }, React.createElement("button", { className: "btn-primary", onClick: () => save(editP) }, "Simpan Aturan Box"))
      )
    );
  }

  function EditMenuModal({ menu, bahan, onSave, onClose }) {
    const [m, setM] = useState({ ...menu, resepBahanPokok: menu.resepBahanPokok || [] });
    const [nRB, setNRB] = useState({ bahanId: bahan[0]?.id || "", jadiPcsVarian: "" });
    
    const hppDasarDonatPcs = hitungTotalBahanPokokPerPcs();
    const hppVarianToppingPcs = m.resepBahanPokok.reduce((total, r) => {
      const b = bahan.find(x => x.id === r.bahanId);
      if (!b) return total;
      const kapasitasVarian = parseFloat(r.gram) || 0;
      if (kapasitasVarian > 0) { return total + (parseFloat(b.harga) / kapasitasVarian); }
      return total;
    }, 0);

    const totalHppGabungan = Math.ceil(hppDasarDonatPcs + hppVarianToppingPcs);
    const tambahResep = () => {
      if (!nRB.jadiPcsVarian) return;
      setM({ ...m, resepBahanPokok: [...m.resepBahanPokok, { bahanId: nRB.bahanId, gram: nRB.jadiPcsVarian }] });
      setNRB({ ...nRB, jadiPcsVarian: "" });
    };

    return React.createElement(Modal, { title: "Atur Resep Varian Topping", onClose }, 
      React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Nama Menu Varian:"), React.createElement("input", { className: "inp", value: m.nama, onChange: (e) => setM({ ...m, nama: e.target.value }) })),
      React.createElement("div", { className: "field-group" }, React.createElement("label", null, "Harga Jual Satuan (Rp):"), React.createElement("input", { className: "inp", type: "number", value: m.hargaJual, onChange: (e) => setM({ ...m, hargaJual: e.target.value }) })),
      React.createElement("h4", { className: "sub-title" }, "Komponen Varian Topping Kue"),
      m.resepBahanPokok.map((r, i) => {
        const b = bahan.find(x => x.id === r.bahanId);
        return React.createElement("div", { key: i, className: "resep-row" }, b?.nama, " - 1 Kaleng/Pack Jadi Untuk: ", r.gram, " Pcs Donat");
      }),
      React.createElement("div", { className: "add-row" }, 
        React.createElement("select", { className: "inp inp-sm", value: nRB.bahanId, onChange: (e) => setNRB({ ...nRB, bahanId: e.target.value }) }, bahan.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))),
        React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Jadi berapa pcs kue...", value: nRB.jadiPcsVarian, onChange: (e) => setNRB({ ...nRB, jadiPcsVarian: e.target.value }) }),
        React.createElement("button", { className: "btn-primary btn-sm", onClick: tambahResep }, "+")
      ),
      React.createElement("div", { className: "hpp-preview mt8" }, 
        React.createElement("div", null, "Dilihatkan Bahan Pokok: ", fmtRp(hppDasarDonatPcs), " /pcs"),
        React.createElement("div", null, "Dilihatkan Bahan Varian: ", fmtRp(hppVarianToppingPcs), " /pcs"),
        React.createElement("strong", null, "Total HPP Gabungan: ", fmtRp(totalHppGabungan), " /pcs")
      ),
      React.createElement("div", { className: "row-wrap mt8" }, React.createElement("button", { className: "btn-primary", onClick: () => onSave(m) }, "Simpan Komposisi"))
    );
  }

  function SettingCabang({ pushNotif }) { return React.createElement("div", null, "Kelola data operasional lokasi cabang."); }
  function SettingAkun({ pushNotif }) {
    const profiles = S.get("profiles") || [];
    const [jadwalLibur, setJadwalLibur] = useState(() => S.get("jadwalLibur") || {});
    const updateLibur = (userId, hari) => {
      const baru = { ...jadwalLibur, [userId]: hari }; S.set("jadwalLibur", baru); setJadwalLibur(baru); pushNotif("Libur pekerja diperbarui!", "success");
    };
    return React.createElement("div", null, 
      React.createElement("h3", { className: "section-title" }, "Set Jadwal Libur Anti-Bocor Absen"), 
      profiles.filter(p => p.role === "worker").map(p => React.createElement("div", { key: p.user_id, className: "branch-row" }, 
        React.createElement("span", null, p.display_name || p.email),
        React.createElement("select", { className: "inp inp-sm", value: jadwalLibur[p.user_id] || "", onChange: (e) => updateLibur(p.user_id, e.target.value) }, 
          React.createElement("option", { value: "" }, "-- Masuk Terus (Tidak Libur) --"),
          ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"].map(h => React.createElement("option", { key: h, value: h }, h))
        )
      ))
    );
  }

  function InvestorPage({ investorId, pushNotif, me }) {
    const tick = useStoreTick();
    const [selDate, setSelDate] = useState(today());
    const branches = (S.get("branches") || []).filter((b) => b.type === "investasi" && (!investorId || b.investorId === investorId));
    const txs = S.get("transactions") || [];
    const pLapak = S.get("pengeluaranLapak") || [];
    const pOwner = S.get("pengeluaranOwner") || [];

    return React.createElement("div", { className: "page" }, 
      React.createElement("div", { className: "page-header" }, React.createElement("h2", null, "Portal Penanaman Modal Investor Evora")), 
      React.createElement("div", { className: "field-group mt8" }, 
        React.createElement("label", null, "Pilih Tanggal Pemantauan:"),
        React.createElement("input", { type: "date", className: "inp", value: selDate, onChange: (e) => setSelDate(e.target.value) })
      ),
      branches.map((b) => {
        const dayTxs = txs.filter((t) => t.branchId === b.id && t.date === selDate);
        const omzet = dayTxs.reduce((a, t) => a + t.total, 0);
        const pengeluaranHarianLapak = pLapak.filter((p) => p.branchId === b.id && p.date === selDate);
        const totalBiayaLapak = pengeluaranHarianLapak.reduce((a, p) => a + p.jumlah, 0);
        const pengeluaranHarianPusat = pOwner.filter((p) => p.branchId === b.id && p.date === selDate);
        const totalBiayaPusat = pengeluaranHarianPusat.reduce((a, p) => a + p.jumlah, 0);

        return React.createElement("div", { key: b.id, className: "investor-report-card mt12", style: { border: "1px solid #444", padding: "12px", borderRadius: "8px" } }, 
          React.createElement("h3", null, "Cabang: ", b.name),
          React.createElement("div", { style: { fontSize: "14px", color: "#22c55e", fontWeight: "bold" } }, "Omzet Masuk Hari Ini: ", fmtRp(omzet)),
          
          React.createElement("h4", { className: "mt8", style: { marginBottom: "4px", fontSize: "13px", color: "#f87171" } }, "🛑 RINCIAN DETAIL BIAYA PENGELUARAN LAPAK:"),
          // FIX BUG KEEMPAT: Memperbaiki salah ketik pemanggilan array pengeluaran investor rincian detail harian lapak
          pengeluaranHarianLapak.length === 0 ? React.createElement("p", { style: { fontSize: "12px", color: "#888" } }, "• Tidak ada pengeluaran harian di lapak") :
          pengeluaranHarianLapak.map(p => React.createElement("div", { key: p.id, style: { fontSize: "12px", paddingLeft: "8px" } }, "- ", p.keterangan, " (", fmtRp(p.jumlah), ")")),
          
          React.createElement("h4", { className: "mt8", style: { marginBottom: "4px", fontSize: "13px", color: "#f87171" } }, "🛑 RINCIAN DETAIL ALOKASI OPERASIONAL PUSAT (OWNER):"),
          pengeluaranHarianPusat.length === 0 ? React.createElement("p", { style: { fontSize: "12px", color: "#888" } }, "• Tidak ada alokasi biaya dari pusat hari ini") :
          pengeluaranHarianPusat.map(p => React.createElement("div", { key: p.id, style: { fontSize: "12px", paddingLeft: "8px" } }, "- Kategori: ", p.kategori, " | ", p.keterangan, " (", fmtRp(p.jumlah), ")")),
          
          React.createElement("div", { className: "mt12", style: { borderTop: "1px dashed #555", paddingTop: "8px", fontSize: "13px", fontWeight: "bold" } }, 
            "Total Seluruh Beban Pengeluaran Cabang: ", fmtRp(totalBiayaLapak + totalBiayaPusat)
          )
        );
      })
    );
  }

  function App() {
    const [authSession, setAuthSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notifs, setNotifs] = useState([]);
    
    const pushNotif = useCallback((msg, type = "success") => { 
      const id = uid(); setNotifs((n) => [...n, { id, msg, type }]); 
    }, []);
    const removeNotif = useCallback((id) => setNotifs((n) => n.filter((x) => x.id !== id)), []);

    const syncAfterLogin = useCallback(async (session) => {
      setAuthSession(session);
      if (!session) { S.reset(); setProfile(null); setLoading(false); return; }
      setLoading(true);
      try {
        const { data: prof, error } = await sb.from("profiles").select("*").eq("user_id", session.user.id).single();
        if (error) throw error;
        setProfile(prof); await S.loadAll();
        if (prof.role === "owner") { await S.loadKey("profiles").catch((e) => {}); }
        S.startRealtime();
      } catch (ex) { pushNotif(ex?.message || String(ex), "warning"); } finally { setLoading(false); }
    }, [pushNotif]);

    useEffect(() => {
      sb.auth.getSession().then(({ data }) => syncAfterLogin(data?.session || null));
      const { data } = sb.auth.onAuthStateChange((_event, session) => syncAfterLogin(session));
      return () => { try { data?.subscription?.unsubscribe(); } catch (e) {} };
    }, [syncAfterLogin]);

    return React.createElement(React.Fragment, null, 
      !authSession ? React.createElement(LoginPage, null) : 
      React.createElement("div", { className: "app-wrap" }, 
        React.createElement("nav", { className: "top-nav" }, 
          React.createElement("span", { className: "nav-brand" }, "Evora"), 
          React.createElement("button", { className: "btn-logout", onClick: () => sb.auth.signOut() }, "Keluar")
        ), 
        React.createElement("div", { className: "content-wrap" }, 
          loading && React.createElement("p", { className: "info-txt" }, "Memuat data ekosistem Donat Boss..."), 
          !loading && profile?.role === "worker" && React.createElement(WorkerPage, { pushNotif, me: profile }), 
          !loading && profile?.role === "owner" && React.createElement(OwnerPage, { pushNotif, me: profile }), 
          !loading && profile?.role === "investor" && React.createElement(InvestorPage, { investorId: profile.investorId, pushNotif, me: profile })
        )
      ), 
      React.createElement("div", { className: "notif-stack" }, notifs.map((n) => React.createElement(Notif, { key: n.id, msg: n.msg, type: n.type, onClose: () => removeNotif(n.id) })))
    );
  }
  
  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(React.createElement(App, null));
})();
