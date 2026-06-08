var DonatBoss = (() => {
  // ../data/user/work/build/app.jsx
  var { useState, useEffect, useCallback, useMemo } = React;
  var sb = window.sb;
  var uid = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  };
  var S = /* @__PURE__ */ (() => {
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
    const LOCAL_KEYS = /* @__PURE__ */ new Set(["notified_ids"]);
    let cache = {};
    let channels = [];
    const listeners = /* @__PURE__ */ new Set();
    let onError = (msg) => console.warn(msg);
    const emit = () => listeners.forEach((fn) => fn());
    const deepEq = (a, b) => {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    };
    const get = (k, def = null) => {
      if (LOCAL_KEYS.has(k)) {
        try {
          const v = localStorage.getItem(k);
          return v ? JSON.parse(v) : def;
        } catch {
          return def;
        }
      }
      return k in cache ? cache[k] : def;
    };
    const setLocal = (k, v) => {
      if (LOCAL_KEYS.has(k)) {
        try {
          localStorage.setItem(k, JSON.stringify(v));
        } catch {
        }
        emit();
        return;
      }
      cache[k] = v;
      emit();
    };
    const setErrorHandler = (fn) => {
      onError = typeof fn === "function" ? fn : onError;
    };
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
      if (ev === "DELETE") {
        cache[key] = cur.filter((x) => x.id !== id);
        emit();
        return;
      }
      if (ev === "INSERT") {
        cache[key] = [...cur.filter((x) => x.id !== id), rowNew];
        emit();
        return;
      }
      if (ev === "UPDATE") {
        cache[key] = cur.map((x) => x.id === id ? rowNew : x);
        emit();
        return;
      }
    };
    const startRealtime = () => {
      stopRealtime();
      Object.entries(TABLE_BY_KEY).forEach(([key, table]) => {
        if (LOCAL_KEYS.has(key)) return;
        const ch = sb.channel("rt:" + table).on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload) => applyRealtime(key, payload)
        ).subscribe();
        channels.push(ch);
      });
    };
    const stopRealtime = () => {
      channels.forEach((ch) => {
        try {
          sb.removeChannel(ch);
        } catch {
        }
      });
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
        if (!prev) {
          toInsert.push(row);
          continue;
        }
        if (!deepEq(prev, row)) toUpdate.push(row);
      }
      const toDelete = [];
      for (const [id] of bMap.entries()) {
        if (!aMap.has(id)) toDelete.push(id);
      }
      if (toInsert.length) {
        const { error } = await sb.from(table).insert(toInsert);
        if (error) throw error;
      }
      if (toUpdate.length) {
        for (const row of toUpdate) {
          const { id, ...payload } = row;
          const { error } = await sb.from(table).update(payload).eq("id", id);
          if (error) throw error;
        }
      }
      if (toDelete.length) {
        const { error } = await sb.from(table).delete().in("id", toDelete);
        if (error) throw error;
      }
    };
    const set = (key, value) => {
      if (LOCAL_KEYS.has(key)) {
        setLocal(key, value);
        return;
      }
      const before = cache[key];
      cache[key] = value;
      emit();
      persistDiff(key, before, value).catch((e) => onError(e?.message || String(e)));
    };
    const reset = () => {
      stopRealtime();
      cache = {};
      emit();
    };
    const subscribe = (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };
    return { get, set, setLocal, loadAll, loadKey, startRealtime, stopRealtime, reset, subscribe, setErrorHandler };
  })();
  var fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  var today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  var nowTs = () => (/* @__PURE__ */ new Date()).toLocaleString("id-ID");
  var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
  var fmtTs = (v) => {
    if (!v) return "-";
    try {
      return (/* @__PURE__ */ new Date(v)).toLocaleString("id-ID");
    } catch {
      return String(v);
    }
  };
  function useStoreTick() {
    const [tick, setTick] = useState(0);
    useEffect(() => S.subscribe(() => setTick((t) => t + 1)), []);
    return tick;
  }
  var hitungHPP = (menu) => {
    const bahan = S.get("bahanPokok") || [];
    const c1 = (menu.resepBahanPokok || []).reduce((a, r) => {
      const b = bahan.find((x) => x.id === r.bahanId);
      if (!b) return a;
      const hpg = b.satuan === "kg" || b.satuan === "liter" ? b.harga / 1e3 : b.harga;
      return a + hpg * r.gram;
    }, 0);
    const c2 = (menu.resepToping || []).reduce((a, t) => a + (t.harga || 0), 0);
    return Math.ceil(c1 + c2);
  };
  function Modal({ title, onClose, children }) {
    return /* @__PURE__ */ React.createElement("div", { className: "modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal-box", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "modal-header" }, /* @__PURE__ */ React.createElement("span", null, title), /* @__PURE__ */ React.createElement("button", { className: "btn-icon", onClick: onClose }, "X")), /* @__PURE__ */ React.createElement("div", { className: "modal-body" }, children)));
  }
  function Notif({ msg, type, onClose }) {
    useEffect(() => {
      const t = setTimeout(onClose, 4e3);
      return () => clearTimeout(t);
    }, [onClose]);
    return /* @__PURE__ */ React.createElement("div", { className: "notif notif-" + type }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, msg), /* @__PURE__ */ React.createElement("button", { onClick: onClose }, "X"));
  }
  function BarChart({ data, height }) {
    const max = Math.max(...data.map((d) => Math.max(d.v1 || 0, d.v2 || 0)), 1);
    return /* @__PURE__ */ React.createElement("div", { className: "bar-chart", style: { height: (height || 100) + 24 } }, data.map((d, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "bar-col" }, /* @__PURE__ */ React.createElement("div", { className: "bar-wrap", style: { height: height || 100 } }, /* @__PURE__ */ React.createElement("div", { className: "bar-fill bar-a", style: { height: (d.v1 || 0) / max * 100 + "%" } }), /* @__PURE__ */ React.createElement("div", { className: "bar-fill bar-b", style: { height: (d.v2 || 0) / max * 100 + "%" } })), /* @__PURE__ */ React.createElement("div", { className: "bar-label" }, d.label))));
  }
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
        // JURUS GAIB: Auto-convert nama pendek kasir/investor jadi format email internal
        const emailFormat = u.includes("@") ? u : `${u.toLowerCase()}@donatboss.local`;
        
        const { error } = await sb.auth.signInWithPassword({
          email: emailFormat,
          password: password,
        });
        if (error) throw error;
      } catch (ex) {
        setErr(ex?.message || String(ex));
      } finally {
        setBusy(false);
      }
    };

    return /* @__PURE__ */ React.createElement(
      "div",
      { className: "login-wrap" },
      /* @__PURE__ */ React.createElement(
        "div",
        { className: "login-card" },
        /* @__PURE__ */ React.createElement("div", { style: { fontSize: 52, textAlign: "center" } }, "donat"),
        /* @__PURE__ */ React.createElement("h1", { className: "login-title" }, "DonatBoss"),
        /* @__PURE__ */ React.createElement("p", { className: "login-sub" }, "Masuk privat menggunakan Kata Sandi tanpa tautan email."),
        
        /* @__PURE__ */ React.createElement(
          "div",
          { className: "field-group" },
          /* @__PURE__ */ React.createElement("label", null, "Nama User / Username / Email"),
          /* @__PURE__ */ React.createElement("input", {
            className: "inp",
            value: username,
            onChange: (e) => setUsername(e.target.value),
            onKeyDown: (e) => e.key === "Enter" && doLogin(),
            placeholder: "Ketik nama user atau email..."
          })
        ),
        
        /* @__PURE__ */ React.createElement(
          "div",
          { className: "field-group", style: { marginTop: 8 } },
          /* @__PURE__ */ React.createElement("label", null, "Kata Sandi (Password)"),
          /* @__PURE__ */ React.createElement("input", {
            className: "inp",
            type: "password",
            value: password,
            onChange: (e) => setPassword(e.target.value),
            onKeyDown: (e) => e.key === "Enter" && doLogin(),
            placeholder: "Masukkan kata sandi..."
          })
        ),
        
        err && /* @__PURE__ */ React.createElement("p", { style: { color: "#ef4444", fontSize: 13, marginTop: 4 } }, err),
        
        /* @__PURE__ */ React.createElement(
          "button",
          { 
            className: "btn-primary btn-full", 
            onClick: doLogin, 
            disabled: busy,
            style: { marginTop: 12 }
          }, 
          busy ? "Memverifikasi..." : "Masuk"
        ),
        
        /* @__PURE__ */ React.createElement(
          "p",
          { className: "login-hint" }, 
          "Info Operasional: Kasir & Investor cukup ketik nama pendek tanpa tanda keong, cukk!"
        )
      )
    );
  }
  function WorkerPage({ pushNotif, me, mode = "worker" }) {
    const tick = useStoreTick();
    const [tab, setTab] = useState("kasir");
    const [branches, setBranches] = useState(() => S.get("branches") || []);
    const [branchId, setBranchId] = useState(() => me?.branchId || (S.get("branches") || [{}])[0]?.id || "");
    const [menus, setMenus] = useState(() => S.get("menuVarian") || []);
    const [topings, setTopings] = useState(() => S.get("topingTambahan") || []);
    const [cart, setCart] = useState([]);
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
      return [...c, { id: uid(), menuId: menu.id, topingId: null, nama: menu.nama, tipe: menu.tipe || "satuan", isiBox: menu.isiBox || null, hargaJual: menu.hargaJual, hpp: hitungHPP(menu), qty: 1 }];
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
        if (!abs?.checkin_ts) {
          alert("Silakan check-in absensi dulu sebelum input transaksi.");
          return;
        }
      }
      const txs = S.get("transactions") || [];
      S.set("transactions", [...txs, { id: uid(), branchId, date: txDate, ts: nowTs(), items: cart.map((x) => ({ ...x })), total: totalBayar, totalHPP: cart.reduce((a, x) => a + x.hpp * x.qty, 0) }]);
      setCart([]);
      pushNotif("Transaksi disimpan!", "success");
    };
    const saveEdit = (txId, newItems, alasan) => {
      const txs = S.get("transactions") || [];
      const old = txs.find((x) => x.id === txId);
      S.set("transactions", txs.map((t) => t.id === txId ? { ...t, items: newItems, total: newItems.reduce((a, x) => a + x.hargaJual * x.qty, 0), totalHPP: newItems.reduce((a, x) => a + x.hpp * x.qty, 0), edited: true } : t));
      const logs = S.get("editLog") || [];
      S.set("editLog", [...logs, { id: uid(), ts: nowTs(), txId, branchId, branchName: curBranch?.name || branchId, alasan, before: old?.items || [], after: newItems }]);
      setEditModal(null);
      pushNotif("Transaksi diperbarui. Owner diberitahu.", "warning");
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
      setSetoran(entry);
      pushNotif("Setoran dikirim ke Owner!", "success");
    };
    const allowSetoran = mode === "worker";
    const TABS = allowSetoran ? ["kasir", "riwayat", "pengeluaran", "setoran", "absensi"] : ["kasir", "riwayat", "pengeluaran", "absensi"];
    const TAB_LABELS = { kasir: "Kasir", riwayat: "Riwayat", pengeluaran: "Pengeluaran", setoran: "Setoran", absensi: "Absensi" };

    const [absMonth, setAbsMonth] = useState(today().slice(0, 7));
    const todayAbs = useMemo(() => {
      const all = S.get("absensi") || [];
      return all.find((a) => a.user_id === userId && a.date === today()) || null;
    }, [tick, userId]);
    const doCheckin = () => {
      if (!userId) return;
      const all = S.get("absensi") || [];
      const d = today();
      const ex = all.find((a) => a.user_id === userId && a.date === d);
      if (ex?.checkin_ts) {
        pushNotif("Kamu sudah check-in hari ini.", "warning");
        return;
      }
      const row = ex ? { ...ex, checkin_ts: nowIso(), branchId: me?.branchId || branchId } : { id: uid(), user_id: userId, branchId: me?.branchId || branchId, date: d, checkin_ts: nowIso(), checkout_ts: null };
      S.set("absensi", ex ? all.map((a) => a.id === row.id ? row : a) : [...all, row]);
      pushNotif("Check-in berhasil.", "success");
    };
    const doCheckout = () => {
      if (!userId) return;
      const all = S.get("absensi") || [];
      const d = today();
      const ex = all.find((a) => a.user_id === userId && a.date === d);
      if (!ex?.checkin_ts) {
        pushNotif("Kamu belum check-in hari ini.", "warning");
        return;
      }
      if (ex?.checkout_ts) {
        pushNotif("Kamu sudah check-out hari ini.", "warning");
        return;
      }
      const row = { ...ex, checkout_ts: nowIso() };
      S.set("absensi", all.map((a) => a.id === row.id ? row : a));
      pushNotif("Check-out berhasil.", "success");
    };
    const myMonthRows = useMemo(() => {
      const all = S.get("absensi") || [];
      return all.filter((a) => a.user_id === userId && String(a.date || "").startsWith(absMonth));
    }, [tick, userId, absMonth]);
    const monthSnap = useMemo(() => {
      const snaps = S.get("absensiBulanan") || [];
      return snaps.find((s) => s.user_id === userId && s.bulan === absMonth && s.locked) || null;
    }, [tick, userId, absMonth]);
    const calcMonth = useMemo(() => {
      let hadir = 0;
      let menit = 0;
      for (const r of myMonthRows) {
        if (r.checkin_ts) hadir += 1;
        if (r.checkin_ts && r.checkout_ts) {
          const a = Date.parse(r.checkin_ts);
          const b = Date.parse(r.checkout_ts);
          if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) menit += Math.floor((b - a) / 6e4);
        }
      }
      return { hadir, menit };
    }, [myMonthRows]);
    return /* @__PURE__ */ React.createElement("div", { className: "page" }, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("span", { className: "page-icon" }, "W"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", null, "Halaman Pekerja"), /* @__PURE__ */ React.createElement("p", { className: "page-sub" }, curBranch?.name || "\u2014", curBranch?.workers?.length ? " - " + curBranch.workers.join(", ") : ""))), /* @__PURE__ */ React.createElement("div", { className: "row-wrap mb8" }, /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: branchId, onChange: (e) => setBranchId(e.target.value), disabled: !!me?.branchId }, branches.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.name))), /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: txDate, onChange: (e) => setTxDate(e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "tabs" }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TAB_LABELS[t]))), tab === "kasir" && /* @__PURE__ */ React.createElement("div", { className: "kasir-layout" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Menu Satuan"), /* @__PURE__ */ React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe !== "paket").map((m) => /* @__PURE__ */ React.createElement("button", { key: m.id, className: "menu-card", onClick: () => addToCart(m) }, /* @__PURE__ */ React.createElement("div", { className: "menu-name" }, m.nama), /* @__PURE__ */ React.createElement("div", { className: "menu-price" }, fmtRp(m.hargaJual))))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Box / Paket"), /* @__PURE__ */ React.createElement("div", { className: "menu-grid" }, menus.filter((m) => m.tipe === "paket").map((m) => /* @__PURE__ */ React.createElement("button", { key: m.id, className: "menu-card menu-card-paket", onClick: () => addToCart(m) }, /* @__PURE__ */ React.createElement("div", { className: "menu-name" }, m.nama), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, opacity: 0.7 } }, "Isi ", m.isiBox, " pcs"), /* @__PURE__ */ React.createElement("div", { className: "menu-price" }, fmtRp(m.hargaJual))))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Toping Tambahan"), /* @__PURE__ */ React.createElement("div", { className: "menu-grid" }, topings.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.id, className: "menu-card menu-card-toping", onClick: () => addToping(t) }, /* @__PURE__ */ React.createElement("div", { className: "menu-name" }, t.nama), /* @__PURE__ */ React.createElement("div", { className: "menu-price" }, fmtRp(t.hargaJual)))))), /* @__PURE__ */ React.createElement("div", { className: "cart-section" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Keranjang"), cart.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada item"), cart.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.id, className: "cart-item" }, /* @__PURE__ */ React.createElement("div", { className: "cart-item-info" }, /* @__PURE__ */ React.createElement("span", null, item.nama), /* @__PURE__ */ React.createElement("span", { className: "cart-qty" }, "x", item.qty)), /* @__PURE__ */ React.createElement("div", { className: "cart-item-right" }, /* @__PURE__ */ React.createElement("span", null, fmtRp(item.hargaJual * item.qty)), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => removeCart(item.id) }, "X")))), cart.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "cart-total" }, "Total: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(totalBayar))), /* @__PURE__ */ React.createElement("div", { className: "row-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary", onClick: () => setCart([]) }, "Batal"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: submitTx }, "Simpan Transaksi"))), /* @__PURE__ */ React.createElement("div", { className: "omzet-box mt12" }, /* @__PURE__ */ React.createElement("span", null, "Omzet Hari Ini"), /* @__PURE__ */ React.createElement("strong", null, fmtRp(branchOmzet))), /* @__PURE__ */ React.createElement("div", { className: "omzet-box", style: { borderColor: "#5a1a1a" } }, /* @__PURE__ */ React.createElement("span", null, "Pengeluaran"), /* @__PURE__ */ React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(branchPeng))))), tab === "riwayat" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Riwayat - ", txDate), transactions.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada transaksi"), [...transactions].reverse().map((tx) => /* @__PURE__ */ React.createElement("div", { key: tx.id, className: "tx-card" + (tx.edited ? " tx-edited" : "") }, /* @__PURE__ */ React.createElement("div", { className: "tx-header" }, /* @__PURE__ */ React.createElement("span", { className: "tx-id" }, "#", tx.id.slice(0, 6)), /* @__PURE__ */ React.createElement("span", { className: "tx-ts" }, tx.ts), tx.edited && /* @__PURE__ */ React.createElement("span", { className: "badge-edit" }, "Diedit")), tx.items.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "tx-item" }, it.nama, " x", it.qty, " - ", fmtRp(it.hargaJual * it.qty))), /* @__PURE__ */ React.createElement("div", { className: "tx-total" }, "Total: ", fmtRp(tx.total)), /* @__PURE__ */ React.createElement("button", { className: "btn-edit-sm", onClick: () => setEditModal(tx) }, "Edit")))), tab === "pengeluaran" && /* @__PURE__ */ React.createElement(PengeluaranLapak, { branchId, branchName: curBranch?.name || "", date: txDate, pushNotif }), allowSetoran && tab === "setoran" && /* @__PURE__ */ React.createElement("div", { className: "setoran-box-worker" }, /* @__PURE__ */ React.createElement("div", { className: "setoran-status setoran-" + setoran.status }, setoran.status === "belum" && /* @__PURE__ */ React.createElement("span", null, "Belum Setor"), setoran.status === "menunggu" && /* @__PURE__ */ React.createElement("span", null, "Menunggu Konfirmasi Owner"), setoran.status === "selesai" && /* @__PURE__ */ React.createElement("span", null, "Sudah Setor - Dikonfirmasi")), /* @__PURE__ */ React.createElement("div", { className: "setoran-omzet" }, "Omzet: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(branchOmzet))), /* @__PURE__ */ React.createElement("div", { className: "setoran-omzet" }, "Pengeluaran Lapak: ", /* @__PURE__ */ React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(branchPeng))), /* @__PURE__ */ React.createElement("div", { className: "setoran-omzet" }, "Bersih Disetor: ", /* @__PURE__ */ React.createElement("strong", { style: { color: "#22c55e" } }, fmtRp(branchOmzet - branchPeng))), setoran.status === "belum" && /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-full", onClick: doSetoran }, "Setor Sekarang"), setoran.status === "menunggu" && /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Menunggu Owner memverifikasi setoran Anda.")), tab === "absensi" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Absensi"), /* @__PURE__ */ React.createElement("div", { className: "form-card" }, /* @__PURE__ */ React.createElement("div", { className: "row-wrap", style: { justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, "Hari ini"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#9a9690" } }, "Check-in: ", fmtTs(todayAbs?.checkin_ts), " | Check-out: ", fmtTs(todayAbs?.checkout_ts))), /* @__PURE__ */ React.createElement("div", { className: "row-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: doCheckin }, "Check-in"), /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: doCheckout }, "Check-out")))), /* @__PURE__ */ React.createElement("div", { className: "field-group mt8" }, /* @__PURE__ */ React.createElement("label", null, "Rekap Bulan"), /* @__PURE__ */ React.createElement("input", { type: "month", className: "inp inp-sm", value: absMonth, onChange: (e) => setAbsMonth(e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-omzet" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Total Hadir"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, (monthSnap ? monthSnap.total_hadir : calcMonth.hadir), " hari")), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-profit" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Total Jam"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, Math.round(((monthSnap ? monthSnap.total_menit : calcMonth.menit) || 0) / 60 * 10) / 10, " jam"))), monthSnap && /* @__PURE__ */ React.createElement("p", { className: "info-txt mt8" }, "Rekap bulan ini sudah dikunci oleh Owner."), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Riwayat Absensi (", absMonth, ")"), myMonthRows.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada absensi."), [...myMonthRows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, r.date), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, "In: ", fmtTs(r.checkin_ts), " | Out: ", fmtTs(r.checkout_ts)))))), editModal && /* @__PURE__ */ React.createElement(EditTxModal, { tx: editModal, onClose: () => setEditModal(null), onSave: saveEdit }));
  }
  function PengeluaranLapak({ branchId, branchName, date, pushNotif }) {
    const getList = () => (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date === date);
    const [list, setList] = useState(getList);
    const [form, setForm] = useState({ keterangan: "", jumlah: "" });
    const refresh = () => setList(getList());
    const CHIPS = ["Kantong Plastik", "Distribusi", "Transportasi", "Tisu", "Kemasan", "Lain-lain"];
    const tambah = () => {
      if (!form.keterangan || !form.jumlah) {
        alert("Isi semua kolom!");
        return;
      }
      const all = S.get("pengeluaranLapak") || [];
      S.set("pengeluaranLapak", [...all, { id: uid(), branchId, branchName, date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah) }]);
      setForm({ keterangan: "", jumlah: "" });
      refresh();
      pushNotif("Pengeluaran dicatat!", "success");
    };
    const hapus = (id) => {
      S.set("pengeluaranLapak", (S.get("pengeluaranLapak") || []).filter((x) => x.id !== id));
      refresh();
    };
    const total = list.reduce((a, p) => a + p.jumlah, 0);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Pengeluaran Lapak - ", date), /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Catat pengeluaran harian di lapak. Semua dilaporkan ke Owner."), /* @__PURE__ */ React.createElement("div", { className: "chips mt8" }, CHIPS.map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: "chip", onClick: () => setForm((f) => ({ ...f, keterangan: s })) }, s))), /* @__PURE__ */ React.createElement("div", { className: "form-card mt8" }, /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Keterangan"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.keterangan, onChange: (e) => setForm((f) => ({ ...f, keterangan: e.target.value })), placeholder: "Contoh: Beli kantong plastik" })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Jumlah (Rp)"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "number", value: form.jumlah, onChange: (e) => setForm((f) => ({ ...f, jumlah: e.target.value })), placeholder: "5000" })), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: tambah }, "+ Tambah")), list.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt mt8" }, "Belum ada pengeluaran hari ini"), list.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "mt8" }, list.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, p.keterangan), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, p.ts)), /* @__PURE__ */ React.createElement("div", { className: "peng-right" }, /* @__PURE__ */ React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah)), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => hapus(p.id) }, "X")))), /* @__PURE__ */ React.createElement("div", { className: "peng-total" }, "Total: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(total)))));
  }
  function EditTxModal({ tx, onClose, onSave }) {
    const [items, setItems] = useState(tx.items.map((x) => ({ ...x })));
    const [alasan, setAlasan] = useState("");
    const changeQty = (id, qty) => {
      if (qty <= 0) {
        setItems((i) => i.filter((x) => x.id !== id));
        return;
      }
      setItems((i) => i.map((x) => x.id === id ? { ...x, qty } : x));
    };
    return /* @__PURE__ */ React.createElement(Modal, { title: "Edit Transaksi", onClose }, /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Perubahan ini dicatat dan dilaporkan ke Owner."), items.map((it) => /* @__PURE__ */ React.createElement("div", { key: it.id, className: "cart-item" }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, it.nama), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", className: "inp inp-sm", style: { width: 60 }, value: it.qty, onChange: (e) => changeQty(it.id, parseInt(e.target.value) || 0) }), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 80, textAlign: "right" } }, fmtRp(it.hargaJual * it.qty)))), /* @__PURE__ */ React.createElement("div", { className: "field-group mt8" }, /* @__PURE__ */ React.createElement("label", null, "Alasan Edit (wajib)"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: alasan, onChange: (e) => setAlasan(e.target.value), placeholder: "Contoh: salah input qty..." })), /* @__PURE__ */ React.createElement("div", { className: "row-wrap mt8" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary", onClick: onClose }, "Batal"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => {
      if (!alasan.trim()) {
        alert("Wajib isi alasan!");
        return;
      }
      onSave(tx.id, items, alasan);
    } }, "Simpan")));
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
          const noted = S.get("notified_ids") || [];
          const fresh = pending.filter((s) => !noted.includes(s.id));
          if (fresh.length) {
            pushNotif(fresh.length + " setoran menunggu konfirmasi!", "warning");
            S.set("notified_ids", [...noted, ...fresh.map((s) => s.id)]);
          }
        }
      }, 5e3);
      return () => clearInterval(iv);
    }, [pushNotif]);
    const TABS = ["dashboard", "kasir", "setoran", "laporan", "absensi", "pengeluaran", "setting"];
    const TLABEL = { dashboard: "Dashboard", kasir: "Kasir", setoran: "Setoran", laporan: "Laporan", absensi: "Absensi", pengeluaran: "Pengeluaran", setting: "Seting" };
    return /* @__PURE__ */ React.createElement("div", { className: "page" }, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("span", { className: "page-icon" }, "O"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", null, "Panel Owner"), /* @__PURE__ */ React.createElement("p", { className: "page-sub" }, "Kontrol penuh bisnis Anda"))), /* @__PURE__ */ React.createElement("div", { className: "tabs tabs-scroll" }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t) }, TLABEL[t]))), tab === "dashboard" && /* @__PURE__ */ React.createElement(OwnerDashboard, null), tab === "kasir" && /* @__PURE__ */ React.createElement(WorkerPage, { pushNotif, me, mode: "owner" }), tab === "setoran" && /* @__PURE__ */ React.createElement(OwnerSetoran, { pushNotif }), tab === "laporan" && /* @__PURE__ */ React.createElement(OwnerLaporan, null), tab === "absensi" && /* @__PURE__ */ React.createElement(OwnerAbsensi, { pushNotif }), tab === "pengeluaran" && /* @__PURE__ */ React.createElement(PengeluaranOwner, { pushNotif }), tab === "setting" && /* @__PURE__ */ React.createElement(OwnerSetting, { stab, setStab, pushNotif }));
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
    const fPO = pO.filter((p) => p.date >= dr.from && p.date <= dr.to);
    const omzet = fTxs.reduce((a, t) => a + t.total, 0);
    const modal = fTxs.reduce((a, t) => a + t.totalHPP, 0);
    const peng = fPL.reduce((a, p) => a + p.jumlah, 0) + fPO.reduce((a, p) => a + p.jumlah, 0);
    const laba = omzet - modal - peng;
    const branchStats = branches.map((b) => {
      const bTx = fTxs.filter((t) => t.branchId === b.id);
      const bPL = fPL.filter((p) => p.branchId === b.id).reduce((a, p) => a + p.jumlah, 0);
      const bO = bTx.reduce((a, t) => a + t.total, 0);
      const bM = bTx.reduce((a, t) => a + t.totalHPP, 0);
      return { ...b, omzet: bO, modal: bM, peng: bPL, laba: bO - bM - bPL, txCount: bTx.length };
    });
    const mc = {};
    fTxs.forEach((t) => t.items.forEach((it) => {
      mc[it.nama] = (mc[it.nama] || 0) + it.qty;
    }));
    const bs = Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const chart7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dO = txs.filter((t) => t.date === ds).reduce((a, t) => a + t.total, 0);
      const dP = pL.filter((p) => p.date === ds).reduce((a, p) => a + p.jumlah, 0) + pO.filter((p) => p.date === ds).reduce((a, p) => a + p.jumlah, 0);
      const dM = txs.filter((t) => t.date === ds).reduce((a, t) => a + t.totalHPP, 0);
      chart7.push({ label: ds.slice(5), v1: dO, v2: dM + dP });
    }
    const branchChart = branchStats.map((b) => ({ label: b.name.slice(0, 8), v1: b.omzet, v2: b.laba }));
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "filter-bar mb8" }, /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: dr.from, onChange: (e) => setDr((r) => ({ ...r, from: e.target.value })) }), /* @__PURE__ */ React.createElement("span", null, "s/d"), /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: dr.to, onChange: (e) => setDr((r) => ({ ...r, to: e.target.value })) }), /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: selBranch, onChange: (e) => setSelBranch(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Semua Cabang"), branches.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.name)))), /* @__PURE__ */ React.createElement("div", { className: "kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-omzet" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Omzet"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(omzet))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-modal" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "HPP Bahan"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(modal))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-peng" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Pengeluaran"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(peng))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-profit" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Laba Bersih"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(laba))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-tx" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Transaksi"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fTxs.length, "x")), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-cab" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Cabang"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, branches.length))), /* @__PURE__ */ React.createElement("div", { className: "two-col mt12" }, /* @__PURE__ */ React.createElement("div", { className: "chart-box" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Omzet vs Beban - 7 Hari"), /* @__PURE__ */ React.createElement(BarChart, { data: chart7, height: 100 }), /* @__PURE__ */ React.createElement("div", { className: "chart-legend mt8" }, /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-a" }), /* @__PURE__ */ React.createElement("span", null, "Omzet"), /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-b", style: { marginLeft: 12 } }), /* @__PURE__ */ React.createElement("span", null, "HPP+Peng"))), /* @__PURE__ */ React.createElement("div", { className: "chart-box" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Omzet Per Cabang"), /* @__PURE__ */ React.createElement(BarChart, { data: branchChart, height: 100 }), /* @__PURE__ */ React.createElement("div", { className: "chart-legend mt8" }, /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-a" }), /* @__PURE__ */ React.createElement("span", null, "Omzet"), /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-b", style: { marginLeft: 12 } }), /* @__PURE__ */ React.createElement("span", null, "Laba")))), /* @__PURE__ */ React.createElement("div", { className: "two-col mt12" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Performa Cabang"), branchStats.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.id, className: "branch-stat-card" }, /* @__PURE__ */ React.createElement("div", { className: "branch-stat-name" }, b.name, " ", /* @__PURE__ */ React.createElement("span", { className: "badge-type " + b.type }, b.type)), b.workers?.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "branch-workers" }, b.workers.join(", ")), /* @__PURE__ */ React.createElement("div", { className: "branch-stat-row" }, /* @__PURE__ */ React.createElement("span", null, "Omzet"), /* @__PURE__ */ React.createElement("strong", null, fmtRp(b.omzet))), /* @__PURE__ */ React.createElement("div", { className: "branch-stat-row" }, /* @__PURE__ */ React.createElement("span", null, "HPP"), /* @__PURE__ */ React.createElement("strong", null, fmtRp(b.modal))), /* @__PURE__ */ React.createElement("div", { className: "branch-stat-row" }, /* @__PURE__ */ React.createElement("span", null, "Pengeluaran"), /* @__PURE__ */ React.createElement("strong", { style: { color: "#ef4444" } }, fmtRp(b.peng))), /* @__PURE__ */ React.createElement("div", { className: "branch-stat-row" }, /* @__PURE__ */ React.createElement("span", null, "Laba"), /* @__PURE__ */ React.createElement("strong", { style: { color: "#22c55e" } }, fmtRp(b.laba))), /* @__PURE__ */ React.createElement("div", { className: "branch-stat-row" }, /* @__PURE__ */ React.createElement("span", null, "Transaksi"), /* @__PURE__ */ React.createElement("strong", null, b.txCount, "x"))))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Best Seller"), bs.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada data"), bs.map(([nama, qty], i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "bestseller-row" }, /* @__PURE__ */ React.createElement("span", { className: "bs-rank" }, "#", i + 1), /* @__PURE__ */ React.createElement("span", { className: "bs-nama" }, nama), /* @__PURE__ */ React.createElement("span", { className: "bs-qty" }, qty, " pcs"))))));
  }
  function PengeluaranOwner({ pushNotif }) {
    const [date, setDate] = useState(today());
    const getList = () => S.get("pengeluaranOwner") || [];
    const [list, setList] = useState(getList);
    const [form, setForm] = useState({ keterangan: "", jumlah: "", kategori: "gaji_pekerja" });
    const refresh = () => setList(getList());
    const KATEGORI = [
      { value: "gaji_pekerja", label: "Gaji Pekerja Lapak" },
      { value: "gaji_kitchen", label: "Gaji Central Kitchen" },
      { value: "bahan_baku", label: "Bahan Baku" },
      { value: "operasional", label: "Operasional" },
      { value: "sewa", label: "Sewa Tempat" },
      { value: "lainnya", label: "Lainnya" }
    ];
    const CHIPS = {
      gaji_pekerja: ["Gaji Kasir Pagi", "Gaji Kasir Siang", "Bonus Pekerja"],
      gaji_kitchen: ["Gaji Chef", "Gaji Helper", "Lembur Kitchen"],
      bahan_baku: ["Restok Tepung", "Restok Kentang", "Restok Minyak", "Restok Gas"],
      operasional: ["Listrik", "Air", "Internet"],
      sewa: ["Sewa Lapak", "Sewa Dapur"],
      lainnya: ["Lain-lain"]
    };
    const tambah = () => {
      if (!form.keterangan || !form.jumlah) {
        alert("Isi semua kolom!");
        return;
      }
      S.set("pengeluaranOwner", [...S.get("pengeluaranOwner") || [], { id: uid(), date, ts: nowTs(), keterangan: form.keterangan, jumlah: parseFloat(form.jumlah), kategori: form.kategori }]);
      setForm((f) => ({ ...f, keterangan: "", jumlah: "" }));
      refresh();
      pushNotif("Pengeluaran dicatat!", "success");
    };
    const hapus = (id) => {
      S.set("pengeluaranOwner", (S.get("pengeluaranOwner") || []).filter((x) => x.id !== id));
      refresh();
    };
    const filtered = list.filter((p) => p.date === date);
    const totalHari = filtered.reduce((a, p) => a + p.jumlah, 0);
    const byKat = KATEGORI.map((k) => ({ ...k, total: filtered.filter((p) => p.kategori === k.value).reduce((a, p) => a + p.jumlah, 0) })).filter((k) => k.total > 0);
    const lapakList = (S.get("pengeluaranLapak") || []).filter((p) => p.date === date);
    const branchesData = S.get("branches") || [];
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "filter-bar mb8" }, /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: date, onChange: (e) => setDate(e.target.value) })), /* @__PURE__ */ React.createElement("div", { className: "form-card" }, /* @__PURE__ */ React.createElement("h4", null, "Tambah Pengeluaran Owner"), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Kategori"), /* @__PURE__ */ React.createElement("select", { className: "inp", value: form.kategori, onChange: (e) => setForm((f) => ({ ...f, kategori: e.target.value })) }, KATEGORI.map((k) => /* @__PURE__ */ React.createElement("option", { key: k.value, value: k.value }, k.label)))), /* @__PURE__ */ React.createElement("div", { className: "chips" }, (CHIPS[form.kategori] || []).map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: "chip", onClick: () => setForm((f) => ({ ...f, keterangan: s })) }, s))), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Keterangan"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.keterangan, onChange: (e) => setForm((f) => ({ ...f, keterangan: e.target.value })), placeholder: "Detail pengeluaran..." })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Jumlah (Rp)"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "number", value: form.jumlah, onChange: (e) => setForm((f) => ({ ...f, jumlah: e.target.value })) })), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: tambah }, "+ Tambah")), byKat.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "kpi-grid mt8" }, byKat.map((k) => /* @__PURE__ */ React.createElement("div", { key: k.value, className: "kpi-card kpi-peng" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, k.label), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(k.total))))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Pengeluaran Owner - ", date), filtered.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada pengeluaran"), filtered.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, p.keterangan), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, KATEGORI.find((k) => k.value === p.kategori)?.label, " - ", p.ts)), /* @__PURE__ */ React.createElement("div", { className: "peng-right" }, /* @__PURE__ */ React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah)), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => hapus(p.id) }, "X")))), filtered.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "peng-total" }, "Total: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(totalHari))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Pengeluaran Lapak dari Pekerja - ", date), lapakList.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Tidak ada pengeluaran lapak"), lapakList.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, p.keterangan), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, branchesData.find((b) => b.id === p.branchId)?.name || p.branchName, " - ", p.ts)), /* @__PURE__ */ React.createElement("div", { className: "peng-right" }, /* @__PURE__ */ React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah))))), lapakList.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "peng-total" }, "Total Lapak: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(lapakList.reduce((a, p) => a + p.jumlah, 0)))));
  }
  function OwnerSetoran({ pushNotif }) {
    const [tab, setTab] = useState("harian");
    const [sH, setSH] = useState(() => S.get("setoranHarian") || []);
    const [sB, setSB] = useState(() => S.get("setoranBulanan") || []);
    const [bulan, setBulan] = useState(today().slice(0, 7));
    const branches = S.get("branches") || [];
    const investors = S.get("investors") || [];
    const refresh = () => {
      setSH(S.get("setoranHarian") || []);
      setSB(S.get("setoranBulanan") || []);
    };
    const konfirmasi = (id) => {
      S.set("setoranHarian", (S.get("setoranHarian") || []).map((s) => s.id === id ? { ...s, status: "selesai", konfirmasiTs: nowTs() } : s));
      refresh();
      pushNotif("Setoran dikonfirmasi!", "success");
    };
    const kirimBulanan = (branchId, investorId) => {
      const txs = S.get("transactions") || [];
      const mTxs = txs.filter((t) => t.branchId === branchId && t.date.startsWith(bulan));
      const omzet = mTxs.reduce((a, t) => a + t.total, 0);
      const modal = mTxs.reduce((a, t) => a + t.totalHPP, 0);
      const pLapak = (S.get("pengeluaranLapak") || []).filter((p) => p.branchId === branchId && p.date.startsWith(bulan)).reduce((a, p) => a + p.jumlah, 0);
      const nBranch = Math.max((S.get("branches") || []).length, 1);
      const pOwner = (S.get("pengeluaranOwner") || []).filter((p) => p.date.startsWith(bulan)).reduce((a, p) => a + p.jumlah, 0) / nBranch;
      const laba = omzet - modal - pLapak - pOwner;
      const inv = investors.find((i) => i.id === investorId);
      const bagian = laba * ((inv?.persenBagi || 0) / 100);
      const all = S.get("setoranBulanan") || [];
      const ex = all.find((s) => s.branchId === branchId && s.bulan === bulan && s.investorId === investorId);
      const entry = { id: ex?.id || uid(), branchId, investorId, bulan, omzet, modal, pLapak, pOwner, laba, bagianInvestor: bagian, persen: inv?.persenBagi || 0, status: "menunggu", ts: nowTs() };
      S.set("setoranBulanan", ex ? all.map((s) => s.id === entry.id ? entry : s) : [...all, entry]);
      refresh();
      pushNotif("Laporan bulanan dikirim!", "success");
    };
    const konfirmBulanan = (id) => {
      S.set("setoranBulanan", (S.get("setoranBulanan") || []).map((s) => s.id === id ? { ...s, status: "selesai", konfirmasiTs: nowTs(), confirmedBy: "owner" } : s));
      refresh();
      pushNotif("Laporan bulanan dikonfirmasi!", "success");
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab === "harian" ? " active" : ""), onClick: () => setTab("harian") }, "Harian (Pekerja ke Owner)"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab === "bulanan" ? " active" : ""), onClick: () => setTab("bulanan") }, "Bulanan (Owner ke Investor)")), tab === "harian" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Status Setoran Harian"), sH.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada setoran masuk"), [...sH].reverse().map((s) => {
      const b = branches.find((x) => x.id === s.branchId);
      return /* @__PURE__ */ React.createElement("div", { key: s.id, className: "setoran-card" + (s.status === "menunggu" ? " setoran-card-menunggu" : s.status === "selesai" ? " setoran-card-selesai" : "") }, /* @__PURE__ */ React.createElement("div", { className: "setoran-card-header" }, /* @__PURE__ */ React.createElement("span", null, b?.name || s.branchName || s.branchId), /* @__PURE__ */ React.createElement("span", { className: "setoran-date" }, s.date)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#9a9690" } }, "Omzet: ", fmtRp(s.omzet), " | Pengeluaran: ", fmtRp(s.pengeluaran || 0), " | Bersih: ", fmtRp((s.omzet || 0) - (s.pengeluaran || 0))), /* @__PURE__ */ React.createElement("div", { className: "setoran-card-status" }, s.status === "menunggu" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "badge-warn" }, "Menunggu"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: () => konfirmasi(s.id) }, "Konfirmasi")), s.status === "selesai" && /* @__PURE__ */ React.createElement("span", { className: "badge-ok" }, "Dikonfirmasi - ", s.konfirmasiTs)));
    })), tab === "bulanan" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "field-group mt8" }, /* @__PURE__ */ React.createElement("label", null, "Pilih Bulan"), /* @__PURE__ */ React.createElement("input", { type: "month", className: "inp inp-sm", value: bulan, onChange: (e) => setBulan(e.target.value) })), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Cabang Investasi"), branches.filter((b) => b.type === "investasi").length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada cabang investasi."), branches.filter((b) => b.type === "investasi").map((b) => {
      const inv = investors.find((i) => i.id === b.investorId);
      const ex = sB.find((s) => s.branchId === b.id && s.bulan === bulan && s.investorId === b.investorId);
      return /* @__PURE__ */ React.createElement("div", { key: b.id, className: "setoran-card" }, /* @__PURE__ */ React.createElement("div", { className: "setoran-card-header" }, /* @__PURE__ */ React.createElement("span", null, b.name), /* @__PURE__ */ React.createElement("span", null, "Investor: ", inv?.nama || "-", " (", inv?.persenBagi || 0, "%)")), ex && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#9a9690" } }, "Omzet: ", fmtRp(ex.omzet), " | HPP: ", fmtRp(ex.modal), " | Laba: ", fmtRp(ex.laba), " | ", /* @__PURE__ */ React.createElement("strong", { style: { color: "#f4a227" } }, "Bagian Investor: ", fmtRp(ex.bagianInvestor))), /* @__PURE__ */ React.createElement("div", { className: "setoran-card-status" }, !ex && /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: () => kirimBulanan(b.id, b.investorId) }, "Kirim Laporan"), ex?.status === "menunggu" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "badge-warn" }, "Menunggu Investor"), /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: () => konfirmBulanan(ex.id) }, "Tandai Selesai (Manual)")), ex?.status === "selesai" && /* @__PURE__ */ React.createElement("span", { className: "badge-ok" }, "Dikonfirmasi", ex.confirmedBy ? ` (${ex.confirmedBy})` : "", " - ", ex.konfirmasiTs)));
    })));
  }
  function OwnerLaporan() {
    const [date, setDate] = useState(today());
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const txs = (S.get("transactions") || []).filter((t) => t.date === date && (selBranch === "all" || t.branchId === selBranch));
    const pL = (S.get("pengeluaranLapak") || []).filter((p) => p.date === date && (selBranch === "all" || p.branchId === selBranch));
    const pO = (S.get("pengeluaranOwner") || []).filter((p) => p.date === date);
    const editLogs = (S.get("editLog") || []).filter((l) => selBranch === "all" || l.branchId === selBranch);
    const omzet = txs.reduce((a, t) => a + t.total, 0);
    const modal = txs.reduce((a, t) => a + t.totalHPP, 0);
    const tPL = pL.reduce((a, p) => a + p.jumlah, 0);
    const tPO = pO.reduce((a, p) => a + p.jumlah, 0);
    const laba = omzet - modal - tPL - tPO;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "filter-bar mb8" }, /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: date, onChange: (e) => setDate(e.target.value) }), /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: selBranch, onChange: (e) => setSelBranch(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Semua Cabang"), branches.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.name)))), /* @__PURE__ */ React.createElement("div", { className: "kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-omzet" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Omzet"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(omzet))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-modal" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "HPP Bahan"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(modal))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-peng" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Peng. Lapak"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(tPL))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-peng" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Peng. Owner"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(tPO))), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-profit" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Laba Bersih"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, fmtRp(laba)))), editLogs.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "mt8" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Log Perubahan Kasir"), editLogs.map((log) => /* @__PURE__ */ React.createElement("div", { key: log.id, className: "log-card" }, /* @__PURE__ */ React.createElement("div", { className: "log-header" }, /* @__PURE__ */ React.createElement("span", null, log.ts), /* @__PURE__ */ React.createElement("span", { className: "badge-warn" }, "Diedit Kasir"), /* @__PURE__ */ React.createElement("span", { className: "badge-branch" }, log.branchName || log.branchId)), /* @__PURE__ */ React.createElement("div", { className: "log-detail" }, "TX #", log.txId.slice(0, 6), ' - Alasan: "', log.alasan, '"'), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#9a9690", marginTop: 4 } }, "Sebelum: ", (log.before || []).map((x) => x.nama + " x" + x.qty).join(", "), " - Sesudah: ", (log.after || []).map((x) => x.nama + " x" + x.qty).join(", "))))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Detail Transaksi"), txs.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada transaksi"), txs.map((tx) => /* @__PURE__ */ React.createElement("div", { key: tx.id, className: "tx-card" + (tx.edited ? " tx-edited" : "") }, /* @__PURE__ */ React.createElement("div", { className: "tx-header" }, /* @__PURE__ */ React.createElement("span", { className: "tx-id" }, "#", tx.id.slice(0, 6)), /* @__PURE__ */ React.createElement("span", { className: "badge-branch" }, branches.find((b) => b.id === tx.branchId)?.name || tx.branchId), /* @__PURE__ */ React.createElement("span", { className: "tx-ts" }, tx.ts), tx.edited && /* @__PURE__ */ React.createElement("span", { className: "badge-warn" }, "Diedit")), tx.items.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "tx-item" }, it.nama, " x", it.qty, " = ", fmtRp(it.hargaJual * it.qty), " (HPP: ", fmtRp(it.hpp * it.qty), ")")), /* @__PURE__ */ React.createElement("div", { className: "tx-total" }, "Omzet: ", fmtRp(tx.total), " | HPP: ", fmtRp(tx.totalHPP), " | Laba: ", fmtRp(tx.total - tx.totalHPP)))), pL.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "mt8" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Pengeluaran Lapak"), pL.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, p.keterangan), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, branches.find((b) => b.id === p.branchId)?.name || p.branchName, " - ", p.ts)), /* @__PURE__ */ React.createElement("div", { className: "peng-right" }, /* @__PURE__ */ React.createElement("span", { className: "peng-jml" }, fmtRp(p.jumlah))))), /* @__PURE__ */ React.createElement("div", { className: "peng-total" }, "Total Lapak: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(tPL)))));
  }

  function OwnerAbsensi({ pushNotif }) {
    const tick = useStoreTick();
    const [month, setMonth] = useState(today().slice(0, 7));
    const [selBranch, setSelBranch] = useState("all");
    const branches = S.get("branches") || [];
    const profiles = S.get("profiles") || [];
    const absensi = S.get("absensi") || [];
    const snaps = S.get("absensiBulanan") || [];
    const workers = profiles.filter((p) => p.role === "worker").filter((p) => selBranch === "all" || p.branchId === selBranch);
    const calcUserMonth = useCallback((userId) => {
      const rows2 = absensi.filter((a) => a.user_id === userId && String(a.date || "").startsWith(month));
      let hadir = 0;
      let menit = 0;
      for (const r of rows2) {
        if (r.checkin_ts) hadir += 1;
        if (r.checkin_ts && r.checkout_ts) {
          const a = Date.parse(r.checkin_ts);
          const b = Date.parse(r.checkout_ts);
          if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) menit += Math.floor((b - a) / 6e4);
        }
      }
      return { hadir, menit };
    }, [absensi, month]);
    const rows = useMemo(() => {
      return workers.map((w) => {
        const snap = snaps.find((s) => s.user_id === w.user_id && s.bulan === month && s.locked) || null;
        const calc = calcUserMonth(w.user_id);
        return {
          w,
          locked: !!snap,
          hadir: snap ? snap.total_hadir : calc.hadir,
          menit: snap ? snap.total_menit : calc.menit
        };
      });
    }, [workers, snaps, month, calcUserMonth, tick]);
    const lockMonth = async () => {
      try {
        if (rows.length === 0) {
          pushNotif("Tidak ada pekerja untuk direkap.", "warning");
          return;
        }
        const entries = rows.map((r) => ({
          user_id: r.w.user_id,
          branchId: r.w.branchId,
          bulan: month,
          total_hadir: r.hadir,
          total_menit: r.menit,
          locked: true,
          generated_at: nowIso()
        }));
        const { error } = await sb.from("absensiBulanan").upsert(entries, { onConflict: "user_id,bulan" });
        if (error) throw error;
        await S.loadKey("absensiBulanan");
        pushNotif("Rekap absensi bulan ini berhasil dikunci.", "success");
      } catch (e) {
        pushNotif(e?.message || String(e), "warning");
      }
    };
    const unlockMonth = async () => {
      try {
        for (const r of rows) {
          const { error } = await sb.from("absensiBulanan").update({ locked: false, generated_at: nowIso() }).eq("user_id", r.w.user_id).eq("bulan", month);
          if (error) throw error;
        }
        await S.loadKey("absensiBulanan");
        pushNotif("Kunci rekap bulan ini dibuka.", "success");
      } catch (e) {
        pushNotif(e?.message || String(e), "warning");
      }
    };
    const totalHadir = rows.reduce((a, r) => a + (r.hadir || 0), 0);
    const totalMenit = rows.reduce((a, r) => a + (r.menit || 0), 0);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "filter-bar mb8" }, /* @__PURE__ */ React.createElement("input", { type: "month", className: "inp inp-sm", value: month, onChange: (e) => setMonth(e.target.value) }), /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: selBranch, onChange: (e) => setSelBranch(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Semua Cabang"), branches.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.name))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: lockMonth }, "Kunci Rekap"), /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: unlockMonth }, "Buka Kunci")), /* @__PURE__ */ React.createElement("div", { className: "kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-omzet" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Total Hadir"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, totalHadir, " hari")), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-profit" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Total Jam"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, Math.round(totalMenit / 60 * 10) / 10, " jam")), /* @__PURE__ */ React.createElement("div", { className: "kpi-card kpi-cab" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Pekerja"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val" }, rows.length))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Detail Absensi Bulanan"), rows.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada pekerja / data profiles belum termuat."), rows.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.w.user_id, className: "peng-row" }, /* @__PURE__ */ React.createElement("div", { className: "peng-info" }, /* @__PURE__ */ React.createElement("span", { className: "peng-ket" }, r.w.display_name || r.w.email || r.w.user_id.slice(0, 6)), /* @__PURE__ */ React.createElement("span", { className: "peng-ts" }, "Cabang: ", branches.find((b) => b.id === r.w.branchId)?.name || r.w.branchId || "-", " | Hadir: ", r.hadir, " | Jam: ", Math.round(r.menit / 60 * 10) / 10, r.locked ? " | (Terkunci)" : "")))));
  }
  function OwnerSetting({ stab, setStab, pushNotif }) {
    const TABS = ["hpp", "paket", "cabang", "akun", "investor"];
    const TLABEL = { hpp: "Menu HPP", paket: "Box/Paket", cabang: "Cabang", akun: "Akun", investor: "Investor" };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "tabs tabs-sm" }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, className: "tab" + (stab === t ? " active" : ""), onClick: () => setStab(t) }, TLABEL[t]))), stab === "hpp" && /* @__PURE__ */ React.createElement(SettingHPP, { pushNotif }), stab === "paket" && /* @__PURE__ */ React.createElement(SettingPaket, { pushNotif }), stab === "cabang" && /* @__PURE__ */ React.createElement(SettingCabang, { pushNotif }), stab === "akun" && /* @__PURE__ */ React.createElement(SettingAkun, { pushNotif }), stab === "investor" && /* @__PURE__ */ React.createElement(SettingInvestor, { pushNotif }));
  }
  function SettingHPP({ pushNotif }) {
    const [sub, setSub] = useState("bahan");
    const [bahan, setBahan] = useState(() => S.get("bahanPokok") || []);
    const [menus, setMenus] = useState(() => (S.get("menuVarian") || []).filter((m) => m.tipe !== "paket"));
    const [topings, setTopings] = useState(() => S.get("topingTambahan") || []);
    const [editMenu, setEditMenu] = useState(null);
    const [nB, setNB] = useState({ nama: "", satuan: "kg", harga: "" });
    const [nT, setNT] = useState({ nama: "", gram: "", hargaBahan: "", hargaJual: "" });
    const saveB = () => {
      if (!nB.nama || !nB.harga) return;
      const u = [...bahan, { id: uid(), ...nB, harga: parseFloat(nB.harga) }];
      S.set("bahanPokok", u);
      setBahan(u);
      setNB({ nama: "", satuan: "kg", harga: "" });
      pushNotif("Bahan ditambah!", "success");
    };
    const delB = (id) => {
      const u = bahan.filter((x) => x.id !== id);
      S.set("bahanPokok", u);
      setBahan(u);
    };
    const saveMenu = (m) => {
      const all = S.get("menuVarian") || [];
      const u = all.find((x) => x.id === m.id) ? all.map((x) => x.id === m.id ? m : x) : [...all, { ...m, id: uid() }];
      S.set("menuVarian", u);
      setMenus(u.filter((x) => x.tipe !== "paket"));
      setEditMenu(null);
      pushNotif("Menu disimpan!", "success");
    };
    const delMenu = (id) => {
      const u = (S.get("menuVarian") || []).filter((x) => x.id !== id);
      S.set("menuVarian", u);
      setMenus(u.filter((x) => x.tipe !== "paket"));
    };
    const saveT = () => {
      if (!nT.nama || !nT.gram || !nT.hargaBahan || !nT.hargaJual) return;
      const u = [...topings, { id: uid(), ...nT, gram: parseFloat(nT.gram), hargaBahan: parseFloat(nT.hargaBahan), hargaJual: parseFloat(nT.hargaJual) }];
      S.set("topingTambahan", u);
      setTopings(u);
      setNT({ nama: "", gram: "", hargaBahan: "", hargaJual: "" });
      pushNotif("Toping ditambah!", "success");
    };
    const delT = (id) => {
      const u = topings.filter((x) => x.id !== id);
      S.set("topingTambahan", u);
      setTopings(u);
    };
    const SUB_TABS = ["bahan", "menu", "toping"];
    const SUB_LABEL = { bahan: "Bahan Pokok", menu: "Varian Menu", toping: "Toping Tambahan" };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "tabs tabs-sm" }, SUB_TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t, className: "tab" + (sub === t ? " active" : ""), onClick: () => setSub(t) }, SUB_LABEL[t]))), sub === "bahan" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Bahan Pokok"), /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Harga per satuan. Otomatis dikalkulasi ke HPP berdasarkan gram di resep."), /* @__PURE__ */ React.createElement("table", { className: "tbl mt8" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Nama"), /* @__PURE__ */ React.createElement("th", null, "Satuan"), /* @__PURE__ */ React.createElement("th", null, "Harga"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, bahan.map((b) => /* @__PURE__ */ React.createElement("tr", { key: b.id }, /* @__PURE__ */ React.createElement("td", null, b.nama), /* @__PURE__ */ React.createElement("td", null, b.satuan), /* @__PURE__ */ React.createElement("td", null, fmtRp(b.harga)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => delB(b.id) }, "Hapus")))))), /* @__PURE__ */ React.createElement("div", { className: "add-row" }, /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", placeholder: "Nama bahan", value: nB.nama, onChange: (e) => setNB((x) => ({ ...x, nama: e.target.value })) }), /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: nB.satuan, onChange: (e) => setNB((x) => ({ ...x, satuan: e.target.value })) }, /* @__PURE__ */ React.createElement("option", null, "kg"), /* @__PURE__ */ React.createElement("option", null, "liter"), /* @__PURE__ */ React.createElement("option", null, "gram"), /* @__PURE__ */ React.createElement("option", null, "tabung"), /* @__PURE__ */ React.createElement("option", null, "pcs")), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Harga", value: nB.harga, onChange: (e) => setNB((x) => ({ ...x, harga: e.target.value })) }), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: saveB }, "+ Tambah"))), sub === "menu" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Varian Menu Satuan"), menus.map((m) => /* @__PURE__ */ React.createElement("div", { key: m.id, className: "menu-setting-card" }, /* @__PURE__ */ React.createElement("div", { className: "menu-setting-row" }, /* @__PURE__ */ React.createElement("strong", null, m.nama), /* @__PURE__ */ React.createElement("span", null, "Jual: ", fmtRp(m.hargaJual), " | HPP: ", fmtRp(hitungHPP(m)))), /* @__PURE__ */ React.createElement("div", { className: "menu-setting-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: () => setEditMenu({ ...m }) }, "Edit"), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => delMenu(m.id) }, "Hapus")))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary mt8", onClick: () => setEditMenu({ id: null, nama: "", tipe: "satuan", hargaJual: "", resepBahanPokok: [], resepToping: [] }) }, "+ Tambah Menu"), editMenu && /* @__PURE__ */ React.createElement(EditMenuModal, { menu: editMenu, bahan, onSave: saveMenu, onClose: () => setEditMenu(null) })), sub === "toping" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Toping Tambahan"), /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "HPP toping saja, tidak termasuk bahan pokok."), /* @__PURE__ */ React.createElement("table", { className: "tbl mt8" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Nama"), /* @__PURE__ */ React.createElement("th", null, "Gram"), /* @__PURE__ */ React.createElement("th", null, "HPP"), /* @__PURE__ */ React.createElement("th", null, "Jual"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, topings.map((t) => /* @__PURE__ */ React.createElement("tr", { key: t.id }, /* @__PURE__ */ React.createElement("td", null, t.nama), /* @__PURE__ */ React.createElement("td", null, t.gram, "g"), /* @__PURE__ */ React.createElement("td", null, fmtRp(t.hargaBahan)), /* @__PURE__ */ React.createElement("td", null, fmtRp(t.hargaJual)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => delT(t.id) }, "Hapus")))))), /* @__PURE__ */ React.createElement("div", { className: "add-row" }, /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", placeholder: "Nama", value: nT.nama, onChange: (e) => setNT((x) => ({ ...x, nama: e.target.value })) }), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Gram", value: nT.gram, onChange: (e) => setNT((x) => ({ ...x, gram: e.target.value })) }), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "HPP (Rp)", value: nT.hargaBahan, onChange: (e) => setNT((x) => ({ ...x, hargaBahan: e.target.value })) }), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Jual (Rp)", value: nT.hargaJual, onChange: (e) => setNT((x) => ({ ...x, hargaJual: e.target.value })) }), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: saveT }, "+ Tambah"))));
  }
  function SettingPaket({ pushNotif }) {
    const [pakets, setPakets] = useState(() => (S.get("menuVarian") || []).filter((m) => m.tipe === "paket"));
    const [bahan] = useState(() => S.get("bahanPokok") || []);
    const [editP, setEditP] = useState(null);
    const save = (m) => {
      const all = S.get("menuVarian") || [];
      const u = all.find((x) => x.id === m.id) ? all.map((x) => x.id === m.id ? m : x) : [...all, { ...m, id: uid() }];
      S.set("menuVarian", u);
      setPakets(u.filter((x) => x.tipe === "paket"));
      setEditP(null);
      pushNotif("Box disimpan!", "success");
    };
    const del = (id) => {
      const u = (S.get("menuVarian") || []).filter((x) => x.id !== id);
      S.set("menuVarian", u);
      setPakets(u.filter((x) => x.tipe === "paket"));
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Box / Paket"), /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Menu dijual per box. Resep = total bahan untuk satu box."), pakets.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, className: "menu-setting-card" }, /* @__PURE__ */ React.createElement("div", { className: "menu-setting-row" }, /* @__PURE__ */ React.createElement("strong", null, p.nama), /* @__PURE__ */ React.createElement("span", { className: "badge-paket" }, "Isi ", p.isiBox, " pcs"), /* @__PURE__ */ React.createElement("span", null, "Jual: ", fmtRp(p.hargaJual), " | HPP: ", fmtRp(hitungHPP(p)))), /* @__PURE__ */ React.createElement("div", { className: "menu-setting-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: () => setEditP({ ...p }) }, "Edit"), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => del(p.id) }, "Hapus")))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary mt8", onClick: () => setEditP({ id: null, nama: "", tipe: "paket", isiBox: 3, hargaJual: "", resepBahanPokok: [], resepToping: [] }) }, "+ Tambah Box"), editP && /* @__PURE__ */ React.createElement(EditMenuModal, { menu: editP, bahan, isPaket: true, onSave: save, onClose: () => setEditP(null) }));
  }
  function EditMenuModal({ menu, bahan, isPaket, onSave, onClose }) {
    const [m, setM] = useState({ ...menu, tipe: isPaket ? "paket" : "satuan", resepBahanPokok: menu.resepBahanPokok || [], resepToping: menu.resepToping || [] });
    const [nRB, setNRB] = useState({ bahanId: bahan[0]?.id || "", gram: "" });
    const [nRT, setNRT] = useState({ nama: "", gram: "", harga: "" });
    const addRB = () => {
      if (!nRB.bahanId || !nRB.gram) return;
      setM((p) => ({ ...p, resepBahanPokok: [...p.resepBahanPokok, { bahanId: nRB.bahanId, gram: parseFloat(nRB.gram) }] }));
      setNRB((x) => ({ ...x, gram: "" }));
    };
    const delRB = (i) => setM((p) => ({ ...p, resepBahanPokok: p.resepBahanPokok.filter((_, idx) => idx !== i) }));
    const addRT = () => {
      if (!nRT.nama || !nRT.gram || !nRT.harga) return;
      setM((p) => ({ ...p, resepToping: [...p.resepToping, { nama: nRT.nama, gram: parseFloat(nRT.gram), harga: parseFloat(nRT.harga) }] }));
      setNRT({ nama: "", gram: "", harga: "" });
    };
    const delRT = (i) => setM((p) => ({ ...p, resepToping: p.resepToping.filter((_, idx) => idx !== i) }));
    const hpp = hitungHPP(m);
    return /* @__PURE__ */ React.createElement(Modal, { title: (isPaket ? "Box - " : "Menu - ") + (m.id ? "Edit" : "Tambah"), onClose }, /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: m.nama, onChange: (e) => setM((x) => ({ ...x, nama: e.target.value })) })), isPaket && /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Isi Box (pcs)"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "number", value: m.isiBox || 3, onChange: (e) => setM((x) => ({ ...x, isiBox: parseInt(e.target.value) || 3 })) })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Harga Jual"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "number", value: m.hargaJual, onChange: (e) => setM((x) => ({ ...x, hargaJual: parseFloat(e.target.value) || 0 })) })), /* @__PURE__ */ React.createElement("h4", { className: "sub-title" }, "Resep Bahan Pokok ", isPaket ? "(total untuk " + m.isiBox + " pcs)" : ""), m.resepBahanPokok.map((r, i) => {
      const b = bahan.find((x) => x.id === r.bahanId);
      return /* @__PURE__ */ React.createElement("div", { key: i, className: "resep-row" }, b?.nama, " - ", r.gram, "g ", /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => delRB(i) }, "X"));
    }), /* @__PURE__ */ React.createElement("div", { className: "add-row" }, /* @__PURE__ */ React.createElement("select", { className: "inp inp-sm", value: nRB.bahanId, onChange: (e) => setNRB((x) => ({ ...x, bahanId: e.target.value })) }, bahan.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.nama))), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Gram", value: nRB.gram, onChange: (e) => setNRB((x) => ({ ...x, gram: e.target.value })) }), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: addRB }, "+")), /* @__PURE__ */ React.createElement("h4", { className: "sub-title" }, "Toping Menu"), m.resepToping.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "resep-row" }, t.nama, " - ", t.gram, "g - ", fmtRp(t.harga), " ", /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => delRT(i) }, "X"))), /* @__PURE__ */ React.createElement("div", { className: "add-row" }, /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", placeholder: "Nama toping", value: nRT.nama, onChange: (e) => setNRT((x) => ({ ...x, nama: e.target.value })) }), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Gram", value: nRT.gram, onChange: (e) => setNRT((x) => ({ ...x, gram: e.target.value })) }), /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", placeholder: "Harga (Rp)", value: nRT.harga, onChange: (e) => setNRT((x) => ({ ...x, harga: e.target.value })) }), /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: addRT }, "+")), /* @__PURE__ */ React.createElement("div", { className: "hpp-preview" }, "HPP: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp(hpp)), " | Margin: ", /* @__PURE__ */ React.createElement("strong", null, fmtRp((m.hargaJual || 0) - hpp)), isPaket ? " | Per pcs: " + fmtRp(Math.ceil(hpp / (m.isiBox || 3))) : ""), /* @__PURE__ */ React.createElement("div", { className: "row-wrap mt8" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary", onClick: onClose }, "Batal"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => {
      if (!m.nama) {
        alert("Isi nama!");
        return;
      }
      onSave(m);
    } }, "Simpan")));
  }
  function SettingCabang({ pushNotif }) {
    const [branches, setBranches] = useState(() => S.get("branches") || []);
    const investors = S.get("investors") || [];
    const [form, setForm] = useState({ nama: "", type: "mandiri", investorId: "", workers: "" });
    const [editB, setEditB] = useState(null);
    const add = () => {
      if (!form.nama) return;
      const wArr = form.workers.split(",").map((s) => s.trim()).filter(Boolean);
      const u = [...branches, { id: uid(), name: form.nama, type: form.type, investorId: form.type === "investasi" ? form.investorId : null, workers: wArr }];
      S.set("branches", u);
      setBranches(u);
      setForm({ nama: "", type: "mandiri", investorId: "", workers: "" });
      pushNotif("Cabang ditambahkan!", "success");
    };
    const saveEdit = () => {
      const wArr = editB.ws.split(",").map((s) => s.trim()).filter(Boolean);
      const u = branches.map((b) => b.id === editB.id ? { ...b, name: editB.name, workers: wArr, type: editB.type, investorId: editB.type === "investasi" ? editB.investorId : null } : b);
      S.set("branches", u);
      setBranches(u);
      setEditB(null);
      pushNotif("Cabang diperbarui!", "success");
    };
    const del = (id) => {
      const u = branches.filter((x) => x.id !== id);
      S.set("branches", u);
      setBranches(u);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Kelola Cabang"), branches.map((b) => /* @__PURE__ */ React.createElement("div", { key: b.id, className: "branch-row" }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("strong", null, b.name), " ", /* @__PURE__ */ React.createElement("span", { className: "badge-type " + b.type }, b.type), b.workers?.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "branch-workers" }, b.workers.join(", ")), b.type === "investasi" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#9a9690" } }, "Investor: ", investors.find((i) => i.id === b.investorId)?.nama || "-")), /* @__PURE__ */ React.createElement("button", { className: "btn-secondary btn-sm", onClick: () => setEditB({ ...b, ws: (b.workers || []).join(", ") }) }, "Edit"), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => del(b.id) }, "Hapus"))), editB && /* @__PURE__ */ React.createElement(Modal, { title: "Edit Cabang", onClose: () => setEditB(null) }, /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama Cabang"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: editB.name, onChange: (e) => setEditB((x) => ({ ...x, name: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama Pekerja (pisah koma)"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: editB.ws, onChange: (e) => setEditB((x) => ({ ...x, ws: e.target.value })), placeholder: "Andi, Sari, Budi" })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Tipe"), /* @__PURE__ */ React.createElement("div", { className: "role-tabs" }, /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (editB.type === "mandiri" ? " active" : ""), onClick: () => setEditB((x) => ({ ...x, type: "mandiri" })) }, "Mandiri"), /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (editB.type === "investasi" ? " active" : ""), onClick: () => setEditB((x) => ({ ...x, type: "investasi" })) }, "Investasi"))), editB.type === "investasi" && /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Investor"), /* @__PURE__ */ React.createElement("select", { className: "inp", value: editB.investorId, onChange: (e) => setEditB((x) => ({ ...x, investorId: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "-- Pilih --"), investors.map((i) => /* @__PURE__ */ React.createElement("option", { key: i.id, value: i.id }, i.nama, " (", i.persenBagi, "%)")))), /* @__PURE__ */ React.createElement("div", { className: "row-wrap mt8" }, /* @__PURE__ */ React.createElement("button", { className: "btn-secondary", onClick: () => setEditB(null) }, "Batal"), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: saveEdit }, "Simpan"))), /* @__PURE__ */ React.createElement("div", { className: "form-card mt12" }, /* @__PURE__ */ React.createElement("h4", null, "Tambah Cabang Baru"), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama Cabang"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.nama, onChange: (e) => setForm((x) => ({ ...x, nama: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama Pekerja (pisah koma)"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.workers, onChange: (e) => setForm((x) => ({ ...x, workers: e.target.value })), placeholder: "Andi, Sari" })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Tipe"), /* @__PURE__ */ React.createElement("div", { className: "role-tabs" }, /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (form.type === "mandiri" ? " active" : ""), onClick: () => setForm((x) => ({ ...x, type: "mandiri" })) }, "Mandiri"), /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (form.type === "investasi" ? " active" : ""), onClick: () => setForm((x) => ({ ...x, type: "investasi" })) }, "Investasi"))), form.type === "investasi" && /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Investor"), /* @__PURE__ */ React.createElement("select", { className: "inp", value: form.investorId, onChange: (e) => setForm((x) => ({ ...x, investorId: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "-- Pilih --"), investors.map((i) => /* @__PURE__ */ React.createElement("option", { key: i.id, value: i.id }, i.nama, " (", i.persenBagi, "%)")))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: add }, "+ Tambah Cabang")));
  }
        function SettingAkun({ pushNotif }) {
    const tick = useStoreTick();
    const branches = S.get("branches") || [];
    const investors = S.get("investors") || [];
    const profiles = S.get("profiles") || [];
    const [invites, setInvites] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [deletedIds, setDeletedIds] = useState([]);
    const [form, setForm] = useState({
      role: "worker",
      email: "",
      password: "",
      displayName: "",
      branchId: branches[0]?.id || "",
      investorId: investors[0]?.id || ""
    });
    useEffect(() => {
      if (!form.branchId && branches[0]?.id) setForm((f) => ({ ...f, branchId: branches[0].id }));
      if (!form.investorId && investors[0]?.id) setForm((f) => ({ ...f, investorId: investors[0].id }));
    }, [tick]);
    const refreshInvites = async () => {
      setLoading(true);
      try {
        const { data, error } = await sb.from("invites").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        setInvites(data || []);
      } catch (e) {
        pushNotif(e?.message || String(e), "warning");
      } finally {
        setLoading(false);
      }
    };
    useEffect(() => {
      refreshInvites();
    }, []);
    const createInvite = async () => {
      const emailInput = String(form.email || "").trim();
      const pwdInput = String(form.password || "").trim();
      if (!emailInput) {
        alert("Username / Email tidak boleh kosong.");
        return;
      }
      if (!pwdInput || pwdInput.length < 6) {
        alert("Password wajib diisi (minimal 6 karakter).");
        return;
      }
      if (form.role === "worker" && !form.branchId) {
        alert("Pilih cabang untuk pekerja.");
        return;
      }
      if (form.role === "investor" && !form.investorId) {
        alert("Pilih investor.");
        return;
      }
      
      const emailFormat = emailInput.includes("@") ? emailInput : `${emailInput.toLowerCase()}@donatboss.local`;
      
      try {
        const { data: sessData } = await sb.auth.getSession();
const token = sessData?.session?.access_token;
if (!token) throw new Error("Owner harus login dulu.");

const resp = await fetch("/api/create-user", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  },
  body: JSON.stringify({
    emailOrUsername: emailFormat,
    password: pwdInput,
    role: form.role,
    displayName: String(form.displayName || "").trim() || null,
    branchId: form.role === "worker" ? form.branchId : null,
    investorId: form.role === "investor" ? form.investorId : null,
  }),
});

const json = await resp.json();
if (!resp.ok) throw new Error(json?.error || "Gagal membuat user.");

        
        pushNotif("Akun Berhasil Dibuat Aktif Instan!", "success");
        setForm((f) => ({ ...f, email: "", password: "", displayName: "" }));
        refreshInvites();
      } catch (e) {
        pushNotif(e?.message || String(e), "warning");
      }
    };
    const deleteInvite = async (id) => {
      if (!confirm("Hapus invite ini?")) return;
      try {
        const { error } = await sb.from("invites").delete().eq("id", id);
        if (error) throw error;
        refreshInvites();
      } catch (e) {
        pushNotif(e?.message || String(e), "warning");
      }
    };
    
    const filteredProfiles = profiles.filter(p => !deletedIds.includes(p.user_id));

    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Akun & Invite"), /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Kelola pendaftaran akun pekerja dan investor langsung dengan password dari aplikasi."), /* @__PURE__ */ React.createElement("div", { className: "form-card mt8" }, /* @__PURE__ */ React.createElement("h4", null, "Buat Akun Baru"), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Role"), /* @__PURE__ */ React.createElement("div", { className: "role-tabs" }, /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (form.role === "worker" ? " active" : ""), onClick: () => setForm((f) => ({ ...f, role: "worker" })) }, "Pekerja"), /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (form.role === "investor" ? " active" : ""), onClick: () => setForm((f) => ({ ...f, role: "investor" })) }, "Investor"), /* @__PURE__ */ React.createElement("button", { className: "role-tab" + (form.role === "owner" ? " active" : ""), onClick: () => setForm((f) => ({ ...f, role: "owner" })) }, "Owner"))), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Username / Email"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.email, onChange: (e) => setForm((f) => ({ ...f, email: e.target.value })), placeholder: "Ketik nama user (misal: satria)" })), /* @__PURE__ */ React.createElement("div", { className: "field-group", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("label", null, "Kata Sandi (Password)"), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", display: "flex", alignItems: "center" } }, /* @__PURE__ */ React.createElement("input", { className: "inp", type: showPassword ? "text" : "password", value: form.password, onChange: (e) => setForm((f) => ({ ...f, password: e.target.value })), placeholder: "Minimal 6 karakter..." }), /* @__PURE__ */ React.createElement("button", { type: "button", style: { position: "absolute", right: 10, background: "none", border: "none", color: "var(--text2)", cursor: "pointer", fontSize: 11, fontWeight: "700" }, onClick: () => setShowPassword(!showPassword) }, showPassword ? "SEMBUNYIKAN" : "LIHAT"))), /* @__PURE__ */ React.createElement("div", { className: "field-group", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("label", null, "Nama Tampilan (opsional)"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.displayName, onChange: (e) => setForm((f) => ({ ...f, displayName: e.target.value })), placeholder: "Nama asli kasir..." })), form.role === "worker" && /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Cabang"), /* @__PURE__ */ React.createElement("select", { className: "inp", value: form.branchId, onChange: (e) => setForm((f) => ({ ...f, branchId: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "-- Pilih --"), branches.map((b) => /* @__PURE__ */ React.createElement("option", { key: b.id, value: b.id }, b.name)))), form.role === "investor" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Pilih Investor"), /* @__PURE__ */ React.createElement("select", { className: "inp", value: form.investorId, onChange: (e) => setForm((f) => ({ ...f, investorId: e.target.value })) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "-- Pilih --"), investors.map((i) => /* @__PURE__ */ React.createElement("option", { key: i.id, value: i.id }, i.nama, " (", i.persenBagi, "%)"))), investors.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "info-txt mt8" }, "Belum ada investor. Buat dulu di tab Investor."))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: createInvite }, "+ Buat Akun Langsung")), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Daftar Antrean Akun"), loading && /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Memuat..."), !loading && invites.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada antrean."), !loading && invites.map((iv) => /* @__PURE__ */ React.createElement("div", { key: iv.id, className: "investor-row" }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("strong", null, iv.email), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#9a9690" } }, "Role: ", iv.role, iv.branchId ? ` | Cabang: ${branches.find((b) => b.id === iv.branchId)?.name || iv.branchId}` : "", iv.investorId ? ` | Investor: ${investors.find((i) => i.id === iv.investorId)?.nama || iv.investorId}` : "")), /* @__PURE__ */ React.createElement("div", { className: "row-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => deleteInvite(iv.id) }, "Hapus")))), /* @__PURE__ */ React.createElement("h3", { className: "section-title mt12" }, "Akun Aktif Terdaftar"), filteredProfiles.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada data profiles."), filteredProfiles.length > 0 && filteredProfiles.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.user_id, className: "branch-row" }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("strong", null, p.display_name || p.email || p.user_id.slice(0, 8)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#9a9690" } }, "Role: ", p.role, p.branchId ? ` | Cabang: ${branches.find((b) => b.id === p.branchId)?.name || p.branchId}` : "")), p.role !== "owner" && /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: async () => { if (!confirm(`Hapus total akun ${p.email || p.display_name}?`)) return; try { const { error } = await sb.rpc("hapus_akun_langsung", { target_user_id: p.user_id, target_email: p.email }); if (error) throw error; setDeletedIds((prev) => [...prev, p.user_id]); pushNotif("Akun berhasil dihapus permanen!", "success"); } catch (err) { pushNotif(err?.message || String(err), "warning"); } } }, "Hapus"))));
  }
  function SettingInvestor({ pushNotif }) {
    const [investors, setInvestors] = useState(() => S.get("investors") || []);
    const [form, setForm] = useState({ nama: "", persenBagi: "" });
    const add = () => {
      if (!form.nama || !form.persenBagi) return;
      const u = [...investors, { id: uid(), nama: form.nama, persenBagi: parseFloat(form.persenBagi) }];
      S.set("investors", u);
      setInvestors(u);
      setForm({ nama: "", persenBagi: "" });
      pushNotif("Investor ditambahkan!", "success");
    };
    const del = (id) => {
      const u = investors.filter((x) => x.id !== id);
      S.set("investors", u);
      setInvestors(u);
    };
    const upP = (id, p) => {
      const u = investors.map((x) => x.id === id ? { ...x, persenBagi: parseFloat(p) || 0 } : x);
      S.set("investors", u);
      setInvestors(u);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { className: "section-title mt8" }, "Kelola Investor"), investors.map((inv) => /* @__PURE__ */ React.createElement("div", { key: inv.id, className: "investor-row" }, /* @__PURE__ */ React.createElement("strong", null, inv.nama), /* @__PURE__ */ React.createElement("div", { className: "row-wrap" }, /* @__PURE__ */ React.createElement("input", { className: "inp inp-sm", type: "number", value: inv.persenBagi, onChange: (e) => upP(inv.id, e.target.value), style: { width: 70 } }), /* @__PURE__ */ React.createElement("span", null, "%"), /* @__PURE__ */ React.createElement("button", { className: "btn-danger-sm", onClick: () => del(inv.id) }, "Hapus")))), /* @__PURE__ */ React.createElement("div", { className: "form-card mt12" }, /* @__PURE__ */ React.createElement("h4", null, "Tambah Investor"), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "Nama"), /* @__PURE__ */ React.createElement("input", { className: "inp", value: form.nama, onChange: (e) => setForm((x) => ({ ...x, nama: e.target.value })) })), /* @__PURE__ */ React.createElement("div", { className: "field-group" }, /* @__PURE__ */ React.createElement("label", null, "% Bagi Hasil"), /* @__PURE__ */ React.createElement("input", { className: "inp", type: "number", value: form.persenBagi, onChange: (e) => setForm((x) => ({ ...x, persenBagi: e.target.value })) })), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: add }, "+ Tambah")));
  }
  function InvestorPage({ investorId, pushNotif, me }) {
    const tick = useStoreTick();
    const [tab, setTab] = useState("harian");
    const [selDate, setSelDate] = useState(today());
    const [month, setMonth] = useState(today().slice(0, 7));
    const investors = S.get("investors") || [];
    const invMe = investors.find((i) => i.id === investorId);
    const branches = (S.get("branches") || []).filter((b) => b.type === "investasi" && (!investorId || b.investorId === investorId));
    const txs = S.get("transactions") || [];
    const pLapak = S.get("pengeluaranLapak") || [];
    const setoranBul = (S.get("setoranBulanan") || []).filter((s) => s.bulan === month && (!investorId || s.investorId === investorId));
    const konfirmBulananInvestor = (id) => {
      const all = S.get("setoranBulanan") || [];
      const target = all.find((x) => x.id === id);
      if (!target) {
        alert("Data laporan tidak ditemukan.");
        return;
      }
      if (investorId && target.investorId !== investorId) {
        alert("Tidak punya akses untuk laporan ini.");
        return;
      }
      S.set("setoranBulanan", all.map((s) => s.id === id ? { ...s, status: "selesai", konfirmasiTs: nowTs(), confirmedBy: "investor" } : s));
      pushNotif?.("Laporan bulanan dikonfirmasi.", "success");
    };
    const chart7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dTxs = txs.filter((t) => branches.some((b) => b.id === t.branchId) && t.date === ds);
      chart7.push({ label: ds.slice(5), v1: dTxs.reduce((a, t) => a + t.total, 0), v2: dTxs.reduce((a, t) => a + t.totalHPP, 0) });
    }
    const branchChart = branches.map((b) => ({
      label: b.name.slice(0, 8),
      v1: txs.filter((t) => t.branchId === b.id).reduce((a, t) => a + t.total, 0),
      v2: txs.filter((t) => t.branchId === b.id).reduce((a, t) => a + t.totalHPP, 0)
    }));
    return /* @__PURE__ */ React.createElement("div", { className: "page" }, /* @__PURE__ */ React.createElement("div", { className: "page-header" }, /* @__PURE__ */ React.createElement("span", { className: "page-icon" }, "I"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", null, "Portal Investor"), /* @__PURE__ */ React.createElement("p", { className: "page-sub" }, invMe?.nama ? `Akun: ${invMe.nama}` : "Cabang Investasi Saja"))), /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab === "harian" ? " active" : ""), onClick: () => setTab("harian") }, "Laporan Harian"), /* @__PURE__ */ React.createElement("button", { className: "tab" + (tab === "bulanan" ? " active" : ""), onClick: () => setTab("bulanan") }, "Laporan Bulanan")), tab === "harian" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "field-group mt8" }, /* @__PURE__ */ React.createElement("label", null, "Pilih Tanggal"), /* @__PURE__ */ React.createElement("input", { type: "date", className: "inp inp-sm", value: selDate, onChange: (e) => setSelDate(e.target.value) })), branches.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada cabang investasi."), branches.map((b) => {
      const inv = investors.find((i) => i.id === b.investorId);
      const dayTxs = txs.filter((t) => t.branchId === b.id && t.date === selDate);
      const peng = pLapak.filter((p) => p.branchId === b.id && p.date === selDate).reduce((a, p) => a + p.jumlah, 0);
      const omzet = dayTxs.reduce((a, t) => a + t.total, 0);
      const modal = dayTxs.reduce((a, t) => a + t.totalHPP, 0);
      const laba = omzet - modal - peng;
      const est = laba * ((inv?.persenBagi || 0) / 100);
      return /* @__PURE__ */ React.createElement("div", { key: b.id, className: "investor-report-card" }, /* @__PURE__ */ React.createElement("div", { className: "investor-report-header" }, /* @__PURE__ */ React.createElement("h3", null, b.name), /* @__PURE__ */ React.createElement("span", { className: "badge-type investasi" }, "Investasi")), /* @__PURE__ */ React.createElement("div", { className: "investor-report-inv" }, "Investor: ", inv?.nama || "-", " | Bagi Hasil: ", inv?.persenBagi || 0, "%"), /* @__PURE__ */ React.createElement("div", { className: "investor-kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Omzet"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(omzet))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "HPP"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(modal))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Pengeluaran"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(peng))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Laba"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(laba))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi inv-kpi-hl", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Est. Bagian Anda (", inv?.persenBagi || 0, "%)"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(est)))), /* @__PURE__ */ React.createElement("h4", { className: "sub-title" }, "Transaksi (", dayTxs.length, "x)"), dayTxs.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada transaksi"), dayTxs.slice(0, 5).map((tx) => /* @__PURE__ */ React.createElement("div", { key: tx.id, className: "tx-card" }, /* @__PURE__ */ React.createElement("div", { className: "tx-header" }, /* @__PURE__ */ React.createElement("span", { className: "tx-id" }, "#", tx.id.slice(0, 6)), /* @__PURE__ */ React.createElement("span", { className: "tx-ts" }, tx.ts)), tx.items.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "tx-item" }, it.nama, " x", it.qty, " - ", fmtRp(it.hargaJual * it.qty))), /* @__PURE__ */ React.createElement("div", { className: "tx-total" }, "Total: ", fmtRp(tx.total)))), dayTxs.length > 5 && /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "+", dayTxs.length - 5, " transaksi lainnya"));
    }), branches.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "chart-box mt8" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Omzet 7 Hari - Cabang Investasi"), /* @__PURE__ */ React.createElement(BarChart, { data: chart7, height: 90 }), /* @__PURE__ */ React.createElement("div", { className: "chart-legend mt8" }, /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-a" }), /* @__PURE__ */ React.createElement("span", null, "Omzet"), /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-b", style: { marginLeft: 12 } }), /* @__PURE__ */ React.createElement("span", null, "HPP")))), tab === "bulanan" && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "field-group mt8" }, /* @__PURE__ */ React.createElement("label", null, "Pilih Bulan"), /* @__PURE__ */ React.createElement("input", { type: "month", className: "inp inp-sm", value: month, onChange: (e) => setMonth(e.target.value) })), branches.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Belum ada cabang investasi."), branches.map((b) => {
      const inv = investors.find((i) => i.id === b.investorId);
      const laporan = setoranBul.find((s) => s.branchId === b.id && s.investorId === b.investorId);
      return /* @__PURE__ */ React.createElement("div", { key: b.id, className: "investor-report-card" }, /* @__PURE__ */ React.createElement("div", { className: "investor-report-header" }, /* @__PURE__ */ React.createElement("h3", null, b.name), /* @__PURE__ */ React.createElement("span", { className: "badge-type investasi" }, "Investasi")), /* @__PURE__ */ React.createElement("div", { className: "investor-report-inv" }, "Investor: ", inv?.nama || "-", " | Bagi Hasil: ", inv?.persenBagi || 0, "%"), !laporan && /* @__PURE__ */ React.createElement("p", { className: "empty-txt" }, "Laporan bulan ini belum dikirim Owner."), laporan && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "investor-kpi-grid" }, /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Omzet"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(laporan.omzet))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "HPP"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(laporan.modal))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Pengeluaran"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp((laporan.pLapak || 0) + (laporan.pOwner || 0)))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi" }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Laba Bersih"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(laporan.laba))), /* @__PURE__ */ React.createElement("div", { className: "inv-kpi inv-kpi-hl", style: { gridColumn: "1/-1" } }, /* @__PURE__ */ React.createElement("div", { className: "kpi-label" }, "Bagian Anda (", laporan.persen, "%)"), /* @__PURE__ */ React.createElement("div", { className: "kpi-val-sm" }, fmtRp(laporan.bagianInvestor)))), /* @__PURE__ */ React.createElement("div", { className: "setoran-status setoran-" + laporan.status, style: { marginTop: 10 } }, laporan.status === "menunggu" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", null, "Laporan diterima, menunggu konfirmasi Anda"), /* @__PURE__ */ React.createElement("div", { className: "row-wrap mt8" }, /* @__PURE__ */ React.createElement("button", { className: "btn-primary btn-sm", onClick: () => konfirmBulananInvestor(laporan.id) }, "Konfirmasi"))), laporan.status === "selesai" && /* @__PURE__ */ React.createElement("span", null, "Dikonfirmasi - ", laporan.konfirmasiTs))));
    }), branchChart.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "chart-box mt8" }, /* @__PURE__ */ React.createElement("h3", { className: "section-title" }, "Omzet Per Cabang Investasi"), /* @__PURE__ */ React.createElement(BarChart, { data: branchChart, height: 90 }), /* @__PURE__ */ React.createElement("div", { className: "chart-legend mt8" }, /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-a" }), /* @__PURE__ */ React.createElement("span", null, "Omzet"), /* @__PURE__ */ React.createElement("span", { className: "leg-dot leg-b", style: { marginLeft: 12 } }), /* @__PURE__ */ React.createElement("span", null, "HPP")))));
  }
  function App() {
    const [authSession, setAuthSession] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notifs, setNotifs] = useState([]);
    const pushNotif = useCallback((msg, type = "success") => {
      const id = uid();
      setNotifs((n) => [...n, { id, msg, type }]);
    }, []);
    const removeNotif = useCallback((id) => setNotifs((n) => n.filter((x) => x.id !== id)), []);
    useEffect(() => {
      S.setErrorHandler((msg) => pushNotif(String(msg), "warning"));
    }, [pushNotif]);
    const syncAfterLogin = useCallback(async (session) => {
      setAuthSession(session);
      if (!session) {
        S.reset();
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data: prof, error } = await sb.from("profiles").select("*").eq("user_id", session.user.id).single();
        if (error) throw error;
        if (!prof || prof.role === "none") {
          pushNotif("Akun kamu belum diundang oleh Owner (akses ditolak).", "warning");
          await sb.auth.signOut();
          return;
        }
        setProfile(prof);
        await S.loadAll();
        if (prof.role === "owner") {
          await S.loadKey("profiles").catch(() => {
          });
        }
        S.startRealtime();
      } catch (ex) {
        pushNotif(ex?.message || String(ex), "warning");
      } finally {
        setLoading(false);
      }
    }, [pushNotif]);
    useEffect(() => {
      let unsub = null;
      sb.auth.getSession().then(({ data: data2 }) => syncAfterLogin(data2?.session || null));
      const { data } = sb.auth.onAuthStateChange((_event, session) => syncAfterLogin(session));
      unsub = data?.subscription;
      return () => {
        try {
          unsub?.unsubscribe();
        } catch {
        }
      };
    }, [syncAfterLogin]);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, !authSession ? /* @__PURE__ */ React.createElement(LoginPage, null) : /* @__PURE__ */ React.createElement("div", { className: "app-wrap" }, /* @__PURE__ */ React.createElement("nav", { className: "top-nav" }, /* @__PURE__ */ React.createElement("span", { className: "nav-brand" }, "DonatBoss"), /* @__PURE__ */ React.createElement("span", { className: "nav-role" }, profile?.role === "owner" ? "Owner" : profile?.role === "worker" ? "Pekerja" : profile?.role === "investor" ? "Investor" : "\u2014"), /* @__PURE__ */ React.createElement("button", { className: "btn-logout", onClick: () => sb.auth.signOut() }, "Keluar")), /* @__PURE__ */ React.createElement("div", { className: "content-wrap" }, loading && /* @__PURE__ */ React.createElement("p", { className: "info-txt" }, "Memuat data..."), !loading && profile?.role === "worker" && /* @__PURE__ */ React.createElement(WorkerPage, { pushNotif, me: profile }), !loading && profile?.role === "owner" && /* @__PURE__ */ React.createElement(OwnerPage, { pushNotif, me: profile }), !loading && profile?.role === "investor" && /* @__PURE__ */ React.createElement(InvestorPage, { investorId: profile.investorId, pushNotif, me: profile }))), /* @__PURE__ */ React.createElement("div", { className: "notif-stack" }, notifs.map((n) => /* @__PURE__ */ React.createElement(Notif, { key: n.id, msg: n.msg, type: n.type, onClose: () => removeNotif(n.id) }))));
  }
  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(/* @__PURE__ */ React.createElement(App, null));
})();
