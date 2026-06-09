var DonatBoss = (() => {
  var { useState, useEffect, useCallback, useMemo } = React;
  var sb = window.sb;
  
  // --- UTILS ---
  var uid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; const v = c === "x" ? r : r & 3 | 8; return v.toString(16); });
  var fmtRp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  var today = () => { const d = new Date(); d.setHours(d.getHours() + 7); return d.toISOString().slice(0, 10); };
  var nowTs = () => new Date().toLocaleString("id-ID");
  var nowIso = () => new Date().toISOString();
  
  var S = { 
    get: (k, def = []) => { try { return JSON.parse(localStorage.getItem("db_" + k) || JSON.stringify(def)); } catch(e){ return def; } },
    set: (k, v) => localStorage.setItem("db_" + k, JSON.stringify(v))
  };

  // --- LOGIKA HPP ---
  var hitungTotalBahanPokokPerPcs = () => {
    const bahan = S.get("bahanPokok");
    return bahan.reduce((t, x) => t + ((parseFloat(x.harga) || 0) / (parseInt(x.jadiPcs) || 1)), 0);
  };

  var hitungHPP = (menu) => {
    const base = hitungTotalBahanPokokPerPcs();
    const bahan = S.get("bahanPokok");
    const varian = (menu.resepBahanPokok || []).reduce((t, r) => {
      const b = bahan.find(x => x.id === r.bahanId);
      return b ? t + (parseFloat(b.harga) / parseFloat(r.gram || 1)) : t;
    }, 0);
    const toping = (menu.resepToping || []).reduce((t, x) => t + (parseFloat(x.harga) || 0), 0);
    return Math.ceil(base + varian + toping);
  };

  // --- HALAMAN LOGIN ---
  function LoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const doLogin = async () => {
      const email = username.includes("@") ? username : `${username.toLowerCase()}@donatboss.local`;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    };
    return React.createElement("div", { className: "login-card" },
      React.createElement("h1", null, "LOGIN EVORA"),
      React.createElement("input", { className: "inp", placeholder: "Username", value: username, onChange: (e) => setUsername(e.target.value) }),
      React.createElement("input", { className: "inp mt8", type: "password", placeholder: "Password", value: password, onChange: (e) => setPassword(e.target.value) }),
      React.createElement("button", { className: "btn-primary btn-full mt8", onClick: doLogin }, "Masuk")
    );
  }

  // --- HALAMAN KASIR ---
  function WorkerPage({ me }) {
    const [tab, setTab] = useState(localStorage.getItem("evora_tab") || "kasir");
    const [cart, setCart] = useState(S.get("evora_cart", []));
    const [absDate, setAbsDate] = useState(today());
    useEffect(() => { localStorage.setItem("evora_tab", tab); S.set("evora_cart", cart); }, [tab, cart]);

    const submitTx = () => {
      const txs = S.get("transactions");
      S.set("transactions", [...txs, { id: uid(), items: cart, total: cart.reduce((a, x) => a + x.hargaJual, 0), date: today() }]);
      setCart([]);
      alert("Transaksi Disimpan!");
    };

    return React.createElement("div", { className: "page" },
      React.createElement("div", { className: "tabs" }, ["kasir", "riwayat", "pengeluaran", "absensi"].map(t => React.createElement("button", { key: t, className: tab === t ? "active" : "", onClick: () => setTab(t) }, t))),
      tab === "kasir" && React.createElement("div", null, 
        S.get("menuVarian").map(m => React.createElement("button", { key: m.id, className: "menu-card", onClick: () => setCart([...cart, m]) }, m.nama)),
        React.createElement("button", { className: "btn-primary", onClick: submitTx }, "Simpan Transaksi")
      ),
      tab === "absensi" && React.createElement("div", null,
        React.createElement("input", { type: "date", value: absDate, onChange: (e) => setAbsDate(e.target.value) }),
        React.createElement("button", { onClick: () => { const a = S.get("absensi"); S.set("absensi", [...a, { id: uid(), date: absDate, user: me.user_id, checkin: nowTs() }]); alert("Absen Disimpan"); } }, "Check-in Tanggal Ini"),
        React.createElement("button", { className: "ml8", onClick: () => { const a = S.get("absensi"); S.set("absensi", a.map(x => x.date === absDate ? {...x, checkout: nowTs()} : x)); alert("Checkout Disimpan"); } }, "Check-out Tanggal Ini")
      ),
      tab === "pengeluaran" && React.createElement(PengeluaranLapak, { me })
    );
  }

  // --- HALAMAN OWNER ---
  function OwnerPage({ me }) {
    const [tab, setTab] = useState("dashboard");
    const TABS = ["dashboard", "kasir", "setoran", "laporan", "absensi", "pengeluaran", "setting"];
    return React.createElement("div", { className: "page" },
      React.createElement("div", { className: "tabs tabs-scroll" }, TABS.map(t => React.createElement("button", { key: t, className: tab === t ? "active" : "", onClick: () => setTab(t) }, t))),
      tab === "dashboard" && React.createElement(OwnerDashboard),
      tab === "pengeluaran" && React.createElement(PengeluaranOwner),
      tab === "setting" && React.createElement(OwnerSetting)
    );
  }

  function PengeluaranOwner() {
    const [f, setF] = useState({ ket: "", jml: "", branch: "", kat: "operasional" });
    const branches = S.get("branches");
    const add = () => {
      const p = S.get("pengeluaranOwner");
      S.set("pengeluaranOwner", [...p, { id: uid(), keterangan: f.ket, jumlah: parseFloat(f.jml), branchId: f.branch, kategori: f.kat, date: today() }]);
      alert("Pengeluaran pusat dicatat!");
    };
    return React.createElement("div", { className: "form-card" },
      React.createElement("select", { value: f.branch, onChange: (e) => setF({...f, branch: e.target.value}) }, branches.map(b => React.createElement("option", { key: b.id, value: b.id }, b.name))),
      React.createElement("input", { placeholder: "Keterangan", value: f.ket, onChange: (e) => setF({...f, ket: e.target.value}) }),
      React.createElement("input", { type: "number", placeholder: "Jumlah", value: f.jml, onChange: (e) => setF({...f, jml: e.target.value}) }),
      React.createElement("button", { onClick: add }, "Simpan Pengeluaran Pusat")
    );
  }

  function OwnerSetting() {
    const [stab, setStab] = useState("hpp");
    return React.createElement("div", null,
      React.createElement("button", { onClick: () => setStab("hpp") }, "HPP"),
      stab === "hpp" && React.createElement(SettingHPP)
    );
  }

  function SettingHPP() {
    const [bahan, setBahan] = useState(S.get("bahanPokok"));
    const [nB, setNB] = useState({ nama: "", harga: "", jadiPcs: "" });
    const add = () => {
      const u = [...bahan, { id: uid(), nama: nB.nama, harga: nB.harga, jadiPcs: nB.jadiPcs }];
      S.set("bahanPokok", u); setBahan(u);
    };
    return React.createElement("div", null,
      React.createElement("input", { placeholder: "Nama Bahan", value: nB.nama, onChange: (e) => setNB({...nB, nama: e.target.value}) }),
      React.createElement("input", { type: "number", placeholder: "Harga", value: nB.harga, onChange: (e) => setNB({...nB, harga: e.target.value}) }),
      React.createElement("input", { type: "number", placeholder: "Jadi Pcs", value: nB.jadiPcs, onChange: (e) => setNB({...nB, jadiPcs: e.target.value}) }),
      React.createElement("button", { onClick: add }, "Simpan Bahan")
    );
  }

  function InvestorPage({ investorId }) {
    const txs = S.get("transactions");
    const pLapak = S.get("pengeluaranLapak");
    const pOwner = S.get("pengeluaranOwner");
    const branches = S.get("branches").filter(b => b.type === "investasi" && (!investorId || b.investorId === investorId));

    return React.createElement("div", { className: "page" },
      branches.map(b => {
        const pengL = pLapak.filter(p => p.branchId === b.id);
        const pengO = pOwner.filter(p => p.branchId === b.id);
        return React.createElement("div", { key: b.id, className: "card" },
          React.createElement("h3", null, b.name),
          React.createElement("h4", null, "Detail Biaya Lapak:"),
          pengL.map(p => React.createElement("div", { key: p.id }, p.keterangan, ": ", fmtRp(p.jumlah))),
          React.createElement("h4", null, "Detail Biaya Pusat:"),
          pengO.map(p => React.createElement("div", { key: p.id }, p.keterangan, ": ", fmtRp(p.jumlah)))
        );
      })
    );
  }

  function App() {
    const [session, setSession] = useState(null);
    const [profile, setProfile] = useState(null);
    useEffect(() => {
      sb.auth.getSession().then(({data}) => setSession(data.session));
      sb.auth.onAuthStateChange((_, s) => setSession(s));
    }, []);
    useEffect(() => {
      if (session) {
        const profs = S.get("profiles");
        setProfile(profs.find(p => p.user_id === session.user.id));
      }
    }, [session]);

    if (!session) return React.createElement(LoginPage);
    if (!profile) return React.createElement("div", null, "Loading...");
    
    return profile.role === "owner" ? React.createElement(OwnerPage, { me: profile }) : 
           profile.role === "investor" ? React.createElement(InvestorPage, { investorId: profile.investorId }) : 
           React.createElement(WorkerPage, { me: profile });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
})();
