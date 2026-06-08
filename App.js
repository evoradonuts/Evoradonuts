// Versi browser (tanpa build tool):
// React & ReactDOM di-load dari CDN (UMD).
const { useState, useEffect, useCallback, useMemo } = React;

// Supabase client (dibuat di supabaseClient.js)
const sb = window.sb;

// ID: pakai UUID agar cocok dengan Supabase (uuid PK).
const uid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // fallback UUID v4 (cukup untuk kebutuhan demo)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Store in-memory + sync ke Supabase (optimistic update) + realtime.
// Desainnya sengaja dibuat mirip API localStorage lama (S.get/S.set)
// supaya UI/logic existing tetap banyak yang bisa dipakai.
const S = (() => {
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
    editLog: "editLog",
    pengeluaranLapak: "pengeluaranLapak",
    pengeluaranOwner: "pengeluaranOwner",
  };

  // key lokal (tidak perlu disimpan ke DB)
  const LOCAL_KEYS = new Set(["notified_ids"]);

  let cache = {};
  let channels = [];
  const listeners = new Set();
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
      } catch {}
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
    const keys = Object.keys(TABLE_BY_KEY).filter((k) => k !== "profiles"); // profiles diambil terpisah
    await Promise.all(keys.map((k) => loadKey(k)));
    emit();
  };

  const applyRealtime = (key, payload) => {
    const table = TABLE_BY_KEY[key];
    if (!table) return;
    const ev = payload.eventType;
    const rowNew = payload.new;
    const rowOld = payload.old;
    const id = (rowNew && rowNew.id) || (rowOld && rowOld.id);
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
      cache[key] = cur.map((x) => (x.id === id ? rowNew : x));
      emit();
      return;
    }
  };

  const startRealtime = () => {
    stopRealtime();
    Object.entries(TABLE_BY_KEY).forEach(([key, table]) => {
      if (LOCAL_KEYS.has(key)) return;
      const ch = sb
        .channel("rt:" + table)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          (payload) => applyRealtime(key, payload)
        )
        .subscribe();
      channels.push(ch);
    });
  };

  const stopRealtime = () => {
    channels.forEach((ch) => {
      try {
        sb.removeChannel(ch);
      } catch {}
    });
    channels = [];
  };

  // Persist perubahan array by id (optimistic update sudah dilakukan sebelum persist).
  const persistDiff = async (key, beforeArr, afterArr) => {
    const table = TABLE_BY_KEY[key];
    if (!table) return;

    const before = Array.isArray(beforeArr) ? beforeArr : [];
    const after = Array.isArray(afterArr) ? afterArr : [];

    const bMap = new Map(before.map((r) => [r.id, r]));
    const aMap = new Map(after.map((r) => [r.id, r]));

    const toUpsert = [];
    for (const [id, row] of aMap.entries()) {
      const prev = bMap.get(id);
      if (!prev || !deepEq(prev, row)) toUpsert.push(row);
    }

    const toDelete = [];
    for (const [id] of bMap.entries()) {
      if (!aMap.has(id)) toDelete.push(id);
    }

    if (toUpsert.length) {
      const { error } = await sb.from(table).upsert(toUpsert, { onConflict: "id" });
      if (error) throw error;
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
    // fire-and-forget persist
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
const fmtRp = n => "Rp " + Number(n||0).toLocaleString("id-ID");
const today = () => new Date().toISOString().slice(0,10);
const nowTs = () => new Date().toLocaleString("id-ID");

function useStoreTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => S.subscribe(() => setTick((t) => t + 1)), []);
  return tick;
}

const hitungHPP = menu => {
  const bahan = S.get("bahanPokok")||[];
  const c1 = (menu.resepBahanPokok||[]).reduce((a,r) => {
    const b = bahan.find(x=>x.id===r.bahanId);
    if (!b) return a;
    const hpg = (b.satuan==="kg"||b.satuan==="liter") ? b.harga/1000 : b.harga;
    return a + hpg*r.gram;
  }, 0);
  const c2 = (menu.resepToping||[]).reduce((a,t) => a+(t.harga||0), 0);
  return Math.ceil(c1+c2);
};

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="btn-icon" onClick={onClose}>X</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Notif({ msg, type, onClose }) {
  useEffect(() => { const t=setTimeout(onClose,4000); return ()=>clearTimeout(t); }, [onClose]);
  return (
    <div className={"notif notif-"+type}>
      <span style={{flex:1}}>{msg}</span>
      <button onClick={onClose}>X</button>
    </div>
  );
}

function BarChart({ data, height }) {
  const max = Math.max(...data.map(d=>Math.max(d.v1||0,d.v2||0)),1);
  return (
    <div className="bar-chart" style={{height:(height||100)+24}}>
      {data.map((d,i) => (
        <div key={i} className="bar-col">
          <div className="bar-wrap" style={{height:height||100}}>
            <div className="bar-fill bar-a" style={{height:((d.v1||0)/max*100)+"%"}} />
            <div className="bar-fill bar-b" style={{height:((d.v2||0)/max*100)+"%"}} />
          </div>
          <div className="bar-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// BEDAH UTAMA: LOGIN DIUBAH MENJADI USERNAME + PASSWORD (ANTI RATE LIMIT)
// =========================================================================
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
      // JURUS GAIB: Auto-convert nama polosan kasir/investor jadi format email internal
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

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ fontSize: 52, textAlign: "center" }}>EVORA</div>
        <h1 className="login-title">donuts</h1>
        <p className="login-sub">Masuk aman menggunakan Kata Sandi tanpa tautan email.</p>

        <div className="field-group">
          <label>Nama User / Username / Email</label>
          <input
            className="inp"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            placeholder="Ketik username (mis. kasirpusat) atau email..."
          />
        </div>

        <div className="field-group" style={{ marginTop: 8 }}>
          <label>Kata Sandi (Password)</label>
          <input
            className="inp"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
            placeholder="Masukkan kata sandi..."
          />
        </div>

        {err && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>{err}</p>}

        <button className="btn-primary btn-full" onClick={doLogin} disabled={busy} style={{ marginTop: 12 }}>
          {busy ? "Memverifikasi..." : "Masuk"}
        </button>

        <p className="login-hint">
          Info Operasional: Owner masuk via email asli. Kasir & Investor cukup ketik nama pendek tanpa tanda keong, cukk!
        </p>
      </div>
    </div>
  );
}

// WORKER
function WorkerPage({ pushNotif, me }) {
  const tick = useStoreTick();
  const [tab, setTab] = useState("kasir");
  const [branches, setBranches] = useState(()=>S.get("branches")||[]);
  const [branchId, setBranchId] = useState(() => me?.branchId || (S.get("branches")||[{}])[0]?.id || "");
  const [menus, setMenus] = useState(()=>S.get("menuVarian")||[]);
  const [topings, setTopings] = useState(()=>S.get("topingTambahan")||[]);
  const [cart, setCart] = useState([]);
  const [txDate, setTxDate] = useState(today());
  const [editModal, setEditModal] = useState(null);

  useEffect(()=>{
    setBranches(S.get("branches")||[]);
    setMenus(S.get("menuVarian")||[]);
    setTopings(S.get("topingTambahan")||[]);
    // kunci cabang untuk pekerja (kalau ditentukan dari profile)
    if (me?.branchId) setBranchId(me.branchId);
  },[tick, me?.branchId]);

  const curBranch = branches.find(b=>b.id===branchId);
  const transactions = (S.get("transactions")||[]).filter(t=>t.branchId===branchId&&t.date===txDate);
  const branchOmzet = transactions.reduce((a,t)=>a+t.total,0);
  const branchPeng = (S.get("pengeluaranLapak")||[]).filter(p=>p.branchId===branchId&&p.date===txDate).reduce((a,p)=>a+p.jumlah,0);

  const addToCart = menu => setCart(c=>{
    const ex=c.find(x=>x.menuId===menu.id);
    if(ex) return c.map(x=>x.menuId===menu.id?{...x,qty:x.qty+1}:x);
    return [...c,{id:uid(),menuId:menu.id,topingId:null,nama:menu.nama,tipe:menu.tipe||"satuan",isiBox:menu.isiBox||null,hargaJual:menu.hargaJual,hpp:hitungHPP(menu),qty:1}];
  });
  const addToping = tp => setCart(c=>{
    const ex=c.find(x=>x.topingId===tp.id);
    if(ex) return c.map(x=>x.topingId===tp.id?{...x,qty:x.qty+1}:x);
    return [...c,{id:uid(),menuId:null,topingId:tp.id,nama:tp.nama+" (Toping)",tipe:"toping",hargaJual:tp.hargaJual,hpp:tp.hargaBahan,qty:1}];
  });
  const removeCart = id => setCart(c=>c.filter(x=>x.id!==id));
  const totalBayar = cart.reduce((a,x)=>a+x.hargaJual*x.qty,0);

  const submitTx = () => {
    if(!cart.length) return;
    const txs=S.get("transactions")||[];
    S.set("transactions",[...txs,{id:uid(),branchId,date:txDate,ts:nowTs(),items:cart.map(x=>({...x})),total:totalBayar,totalHPP:cart.reduce((a,x)=>a+x.hpp*x.qty,0)}]);
    setCart([]);
    pushNotif("Transaksi disimpan!","success");
  };

  const saveEdit = (txId,newItems,alasan) => {
    const txs=S.get("transactions")||[];
    const old=txs.find(x=>x.id===txId);
    S.set("transactions",txs.map(t=>t.id===txId?{...t,items:newItems,total:newItems.reduce((a,x)=>a+x.hargaJual*x.qty,0),totalHPP:newItems.reduce((a,x)=>a+x.hpp*x.qty,0),edited:true}:t));
    const logs=S.get("editLog")||[];
    S.set("editLog",[...logs,{id:uid(),ts:nowTs(),txId,branchId,branchName:curBranch?.name||branchId,alasan,before:old?.items||[],after:newItems}]);
    setEditModal(null);
    pushNotif("Transaksi diperbarui. Owner diberitahu.","warning");
  };

  const getSetoran = useCallback(()=>{
    const s=S.get("setoranHarian")||[];
    return s.find(x=>x.branchId===branchId&&x.date===txDate)||{status:"belum"};
  },[branchId,txDate]);
  const [setoran,setSetoran] = useState(getSetoran);
  useEffect(()=>setSetoran(getSetoran()),[getSetoran]);

  const doSetoran = () => {
    const s=S.get("setoranHarian")||[];
    const existing=s.find(x=>x.branchId===branchId&&x.date===txDate);
    const entry={id:existing?.id||uid(),branchId,branchName:curBranch?.name||branchId,date:txDate,ts:nowTs(),status:"menunggu",omzet:branchOmzet,pengeluaran:branchPeng};
    S.set("setoranHarian",existing?s.map(x=>x.id===entry.id?entry:x):[...s,entry]);
    setSetoran(entry);
    pushNotif("Setoran dikirim ke Owner!","success");
  };

  const TABS = ["kasir","riwayat","pengeluaran","setoran"];
  const TAB_LABELS = {kasir:"Kasir",riwayat:"Riwayat",pengeluaran:"Pengeluaran",setoran:"Setoran"};

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-icon">W</span>
        <div>
          <h2>Halaman Pekerja</h2>
          <p className="page-sub">{curBranch?.name||"—"}{curBranch?.workers?.length?" - "+curBranch.workers.join(", "):""}</p>
        </div>
      </div>
      <div className="row-wrap mb8">
        <select className="inp inp-sm" value={branchId} onChange={e=>setBranchId(e.target.value)} disabled={!!me?.branchId}>
          {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="date" className="inp inp-sm" value={txDate} onChange={e=>setTxDate(e.target.value)} />
      </div>
      <div className="tabs">
        {TABS.map(t=>(
          <button key={t} className={"tab"+(tab===t?" active":"")} onClick={()=>setTab(t)}>{TAB_LABELS[t]}</button>
        ))}
      </div>

      {tab==="kasir" && (
        <div className="kasir-layout">
          <div>
            <h3 className="section-title">Menu Satuan</h3>
            <div className="menu-grid">
              {menus.filter(m=>m.tipe!=="paket").map(m=>(
                <button key={m.id} className="menu-card" onClick={()=>addToCart(m)}>
                  <div className="menu-name">{m.nama}</div>
                  <div className="menu-price">{fmtRp(m.hargaJual)}</div>
                </button>
              ))}
            </div>
            <h3 className="section-title mt12">Box / Paket</h3>
            <div className="menu-grid">
              {menus.filter(m=>m.tipe==="paket").map(m=>(
                <button key={m.id} className="menu-card menu-card-paket" onClick={()=>addToCart(m)}>
                  <div className="menu-name">{m.nama}</div>
                  <div style={{fontSize:11,opacity:.7}}>Isi {m.isiBox} pcs</div>
                  <div className="menu-price">{fmtRp(m.hargaJual)}</div>
                </button>
              ))}
            </div>
            <h3 className="section-title mt12">Toping Tambahan</h3>
            <div className="menu-grid">
              {topings.map(t=>(
                <button key={t.id} className="menu-card menu-card-toping" onClick={()=>addToping(t)}>
                  <div className="menu-name">{t.nama}</div>
                  <div className="menu-price">{fmtRp(t.hargaJual)}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="cart-section">
            <h3 className="section-title">Keranjang</h3>
            {cart.length===0 && <p className="empty-txt">Belum ada item</p>}
            {cart.map(item=>(
              <div key={item.id} className="cart-item">
                <div className="cart-item-info">
                  <span>{item.nama}</span>
                  <span className="cart-qty">x{item.qty}</span>
                </div>
                <div className="cart-item-right">
                  <span>{fmtRp(item.hargaJual*item.qty)}</span>
                  <button className="btn-danger-sm" onClick={()=>removeCart(item.id)}>X</button>
                </div>
              </div>
            ))}
            {cart.length>0 && (
              <>
                <div className="cart-total">Total: <strong>{fmtRp(totalBayar)}</strong></div>
                <div className="row-wrap">
                  <button className="btn-secondary" onClick={()=>setCart([])}>Batal</button>
                  <button className="btn-primary" onClick={submitTx}>Simpan Transaksi</button>
                </div>
              </>
            )}
            <div className="omzet-box mt12"><span>Omzet Hari Ini</span><strong>{fmtRp(branchOmzet)}</strong></div>
            <div className="omzet-box" style={{borderColor:"#5a1a1a"}}><span>Pengeluaran</span><strong style={{color:"#ef4444"}}>{fmtRp(branchPeng)}</strong></div>
          </div>
        </div>
      )}

      {tab==="riwayat" && (
        <div>
          <h3 className="section-title">Riwayat - {txDate}</h3>
          {transactions.length===0 && <p className="empty-txt">Belum ada transaksi</p>}
          {[...transactions].reverse().map(tx=>(
            <div key={tx.id} className={"tx-card"+(tx.edited?" tx-edited":"")}>
              <div className="tx-header">
                <span className="tx-id">#{tx.id.slice(0,6)}</span>
                <span className="tx-ts">{tx.ts}</span>
                {tx.edited && <span className="badge-edit">Diedit</span>}
              </div>
              {tx.items.map((it,i)=><div key={i} className="tx-item">{it.nama} x{it.qty} - {fmtRp(it.hargaJual*it.qty)}</div>)}
              <div className="tx-total">Total: {fmtRp(tx.total)}</div>
              <button className="btn-edit-sm" onClick={()=>setEditModal(tx)}>Edit</button>
            </div>
          ))}
        </div>
      )}

      {tab==="pengeluaran" && (
        <PengeluaranLapak branchId={branchId} branchName={curBranch?.name||""} date={txDate} pushNotif={pushNotif} />
      )}

      {tab==="setoran" && (
        <div className="setoran-box-worker">
          <div className={"setoran-status setoran-"+setoran.status}>
            {setoran.status==="belum" && <span>Belum Setor</span>}
            {setoran.status==="menunggu" && <span>Menunggu Konfirmasi Owner</span>}
            {setoran.status==="selesai" && <span>Sudah Setor - Dikonfirmasi</span>}
          </div>
          <div className="setoran-omzet">Omzet: <strong>{fmtRp(branchOmzet)}</strong></div>
          <div className="setoran-omzet">Pengeluaran Lapak: <strong style={{color:"#ef4444"}}>{fmtRp(branchPeng)}</strong></div>
          <div className="setoran-omzet">Bersih Disetor: <strong style={{color:"#22c55e"}}>{fmtRp(branchOmzet-branchPeng)}</strong></div>
          {setoran.status==="belum" && <button className="btn-primary btn-full" onClick={doSetoran}>Setor Sekarang</button>}
          {setoran.status==="menunggu" && <p className="info-txt">Menunggu Owner memverifikasi setoran Anda.</p>}
        </div>
      )}

      {editModal && <EditTxModal tx={editModal} onClose={()=>setEditModal(null)} onSave={saveEdit} />}
    </div>
  );
}

function PengeluaranLapak({ branchId, branchName, date, pushNotif }) {
  const getList = () => (S.get("pengeluaranLapak")||[]).filter(p=>p.branchId===branchId&&p.date===date);
  const [list,setList] = useState(getList);
  const [form,setForm] = useState({keterangan:"",jumlah:""});
  const refresh = () => setList(getList());
  const CHIPS = ["Kantong Plastik","Distribusi","Transportasi","Tisu","Kemasan","Lain-lain"];
  const tambah = () => {
    if(!form.keterangan||!form.jumlah){alert("Isi semua kolom!");return;}
    const all=S.get("pengeluaranLapak")||[];
    S.set("pengeluaranLapak",[...all,{id:uid(),branchId,branchName,date,ts:nowTs(),keterangan:form.keterangan,jumlah:parseFloat(form.jumlah)}]);
    setForm({keterangan:"",jumlah:""});
    refresh();
    pushNotif("Pengeluaran dicatat!","success");
  };
  const hapus = id => { S.set("pengeluaranLapak",(S.get("pengeluaranLapak")||[]).filter(x=>x.id!==id)); refresh(); };
  const total = list.reduce((a,p)=>a+p.jumlah,0);
  return (
    <div>
      <h3 className="section-title">Pengeluaran Lapak - {date}</h3>
      <p className="info-txt">Catat pengeluaran harian di lapak. Semua dilaporkan ke Owner.</p>
      <div className="chips mt8">
        {CHIPS.map(s=><button key={s} className="chip" onClick={()=>setForm(f=>({...f,keterangan:s}))}>{s}</button>)}
      </div>
      <div className="form-card mt8">
        <div className="field-group">
          <label>Keterangan</label>
          <input className="inp" value={form.keterangan} onChange={e=>setForm(f=>({...f,keterangan:e.target.value}))} placeholder="Contoh: Beli kantong plastik" />
        </div>
        <div className="field-group">
          <label>Jumlah (Rp)</label>
          <input className="inp" type="number" value={form.jumlah} onChange={e=>setForm(f=>({...f,jumlah:e.target.value}))} placeholder="5000" />
        </div>
        <button className="btn-primary" onClick={tambah}>+ Tambah</button>
      </div>
      {list.length===0 && <p className="empty-txt mt8">Belum ada pengeluaran hari ini</p>}
      {list.length>0 && (
        <div className="mt8">
          {list.map(p=>(
            <div key={p.id} className="peng-row">
              <div className="peng-info"><span className="peng-ket">{p.keterangan}</span><span className="peng-ts">{p.ts}</span></div>
              <div className="peng-right"><span className="peng-jml">{fmtRp(p.jumlah)}</span><button className="btn-danger-sm" onClick={()=>hapus(p.id)}>X</button></div>
            </div>
          ))}
          <div className="peng-total">Total: <strong>{fmtRp(total)}</strong></div>
        </div>
      )}
    </div>
  );
}

function EditTxModal({ tx, onClose, onSave }) {
  const [items,setItems] = useState(tx.items.map(x=>({...x})));
  const [alasan,setAlasan] = useState("");
  const changeQty = (id,qty) => {
    if(qty<=0){setItems(i=>i.filter(x=>x.id!==id));return;}
    setItems(i=>i.map(x=>x.id===id?{...x,qty}:x));
  };
  return (
    <Modal title="Edit Transaksi" onClose={onClose}>
      <p className="info-txt">Perubahan ini dicatat dan dilaporkan ke Owner.</p>
      {items.map(it=>(
        <div key={it.id} className="cart-item">
          <span style={{flex:1}}>{it.nama}</span>
          <input type="number" min="0" className="inp inp-sm" style={{width:60}} value={it.qty} onChange={e=>changeQty(it.id,parseInt(e.target.value)||0)} />
          <span style={{minWidth:80,textAlign:"right"}}>{fmtRp(it.hargaJual*it.qty)}</span>
        </div>
      ))}
      <div className="field-group mt8">
        <label>Alasan Edit (wajib)</label>
        <input className="inp" value={alasan} onChange={e=>setAlasan(e.target.value)} placeholder="Contoh: salah input qty..." />
      </div>
      <div className="row-wrap mt8">
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={()=>{if(!alasan.trim()){alert("Wajib isi alasan!");return;}onSave(tx.id,items,alasan);}}>Simpan</button>
      </div>
    </Modal>
  );
}

// OWNER
function OwnerPage({ pushNotif, me }) {
  const tick = useStoreTick(); // agar rerender saat realtime update
  const [tab,setTab] = useState("dashboard");
  const [stab,setStab] = useState("hpp");
  useEffect(()=>{
    const iv=setInterval(()=>{
      const list=S.get("setoranHarian")||[];
      const pending=list.filter(s=>s.status==="menunggu");
      if(pending.length){
        const noted=S.get("notified_ids")||[];
        const fresh=pending.filter(s=>!noted.includes(s.id));
        if(fresh.length){
          pushNotif(fresh.length+" setoran menunggu konfirmasi!","warning");
          S.set("notified_ids",[...noted,...fresh.map(s=>s.id)]);
        }
      }
    },5000);
    return ()=>clearInterval(iv);
  },[pushNotif]);

  const TABS = ["dashboard","setoran","laporan","pengeluaran","setting"];
  const TLABEL = {dashboard:"Dashboard",setoran:"Setoran",laporan:"Laporan",pengeluaran:"Pengeluaran",setting:"Seting"};

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-icon">O</span>
        <div><h2>Panel Owner</h2><p className="page-sub">Kontrol penuh bisnis Anda</p></div>
      </div>
      <div className="tabs tabs-scroll">
        {TABS.map(t=><button key={t} className={"tab"+(tab===t?" active":"")} onClick={()=>setTab(t)}>{TLABEL[t]}</button>)}
      </div>
      {tab==="dashboard" && <OwnerDashboard />}
      {tab==="setoran" && <OwnerSetoran pushNotif={pushNotif} />}
      {tab==="laporan" && <OwnerLaporan />}
      {tab==="pengeluaran" && <PengeluaranOwner pushNotif={pushNotif} />}
      {tab==="setting" && <OwnerSetting stab={stab} setStab={setStab} pushNotif={pushNotif} />}
    </div>
  );
}

function OwnerDashboard() {
  const [dr,setDr] = useState({from:today(),to:today()});
  const [selBranch,setSelBranch] = useState("all");
  const branches=S.get("branches")||[];
  const txs=S.get("transactions")||[];
  const pL=S.get("pengeluaranLapak")||[];
  const pO=S.get("pengeluaranOwner")||[];

  const fTxs=txs.filter(t=>t.date>=dr.from&&t.date<=dr.to&&(selBranch==="all"||t.branchId===selBranch));
  const fPL=pL.filter(p=>p.date>=dr.from&&p.date<=dr.to&&(selBranch==="all"||p.branchId===selBranch));
  const fPO=pO.filter(p=>p.date>=dr.from&&p.date<=dr.to);

  const omzet=fTxs.reduce((a,t)=>a+t.total,0);
  const modal=fTxs.reduce((a,t)=>a+t.totalHPP,0);
  const peng=fPL.reduce((a,p)=>a+p.jumlah,0)+fPO.reduce((a,p)=>a+p.jumlah,0);
  const laba=omzet-modal-peng;

  const branchStats=branches.map(b=>{
    const bTx=fTxs.filter(t=>t.branchId===b.id);
    const bPL=fPL.filter(p=>p.branchId===b.id).reduce((a,p)=>a+p.jumlah,0);
    const bO=bTx.reduce((a,t)=>a+t.total,0);
    const bM=bTx.reduce((a,t)=>a+t.totalHPP,0);
    return {...b,omzet:bO,modal:bM,peng:bPL,laba:bO-bM-bPL,txCount:bTx.length};
  });

  const mc={};
  fTxs.forEach(t=>t.items.forEach(it=>{mc[it.nama]=(mc[it.nama]||0)+it.qty;}));
  const bs=Object.entries(mc).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const chart7=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const ds=d.toISOString().slice(0,10);
    const dO=txs.filter(t=>t.date===ds).reduce((a,t)=>a+t.total,0);
    const dP=pL.filter(p=>p.date===ds).reduce((a,p)=>a+p.jumlah,0)+pO.filter(p=>p.date===ds).reduce((a,p)=>a+p.jumlah,0);
    const dM=txs.filter(t=>t.date===ds).reduce((a,t)=>a+t.totalHPP,0);
    chart7.push({label:ds.slice(5),v1:dO,v2:dM+dP});
  }
  const branchChart=branchStats.map(b=>({label:b.name.slice(0,8),v1:b.omzet,v2:b.laba}));

  return (
    <div>
      <div className="filter-bar mb8">
        <input type="date" className="inp inp-sm" value={dr.from} onChange={e=>setDr(r=>({...r,from:e.target.value}))} />
        <span>s/d</span>
        <input type="date" className="inp inp-sm" value={dr.to} onChange={e=>setDr(r=>({...r,to:e.target.value}))} />
        <select className="inp inp-sm" value={selBranch} onChange={e=>setSelBranch(e.target.value)}>
          <option value="all">Semua Cabang</option>
          {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card kpi-omzet"><div className="kpi-label">Omzet</div><div className="kpi-val">{fmtRp(omzet)}</div></div>
        <div className="kpi-card kpi-modal"><div className="kpi-label">HPP Bahan</div><div className="kpi-val">{fmtRp(modal)}</div></div>
        <div className="kpi-card kpi-peng"><div className="kpi-label">Pengeluaran</div><div className="kpi-val">{fmtRp(peng)}</div></div>
        <div className="kpi-card kpi-profit"><div className="kpi-label">Laba Bersih</div><div className="kpi-val">{fmtRp(laba)}</div></div>
        <div className="kpi-card kpi-tx"><div className="kpi-label">Transaksi</div><div className="kpi-val">{fTxs.length}x</div></div>
        <div className="kpi-card kpi-cab"><div className="kpi-label">Cabang</div><div className="kpi-val">{branches.length}</div></div>
      </div>
      <div className="two-col mt12">
        <div className="chart-box">
          <h3 className="section-title">Omzet vs Beban - 7 Hari</h3>
          <BarChart data={chart7} height={100} />
          <div className="chart-legend mt8">
            <span className="leg-dot leg-a"></span><span>Omzet</span>
            <span className="leg-dot leg-b" style={{marginLeft:12}}></span><span>HPP+Peng</span>
          </div>
        </div>
        <div className="chart-box">
          <h3 className="section-title">Omzet Per Cabang</h3>
          <BarChart data={branchChart} height={100} />
          <div className="chart-legend mt8">
            <span className="leg-dot leg-a"></span><span>Omzet</span>
            <span className="leg-dot leg-b" style={{marginLeft:12}}></span><span>Laba</span>
          </div>
        </div>
      </div>
      <div className="two-col mt12">
        <div>
          <h3 className="section-title">Performa Cabang</h3>
          {branchStats.map(b=>(
            <div key={b.id} className="branch-stat-card">
              <div className="branch-stat-name">{b.name} <span className={"badge-type "+b.type}>{b.type}</span></div>
              {b.workers?.length>0 && <div className="branch-workers">{b.workers.join(", ")}</div>}
              <div className="branch-stat-row"><span>Omzet</span><strong>{fmtRp(b.omzet)}</strong></div>
              <div className="branch-stat-row"><span>HPP</span><strong>{fmtRp(b.modal)}</strong></div>
              <div className="branch-stat-row"><span>Pengeluaran</span><strong style={{color:"#ef4444"}}>{fmtRp(b.peng)}</strong></div>
              <div className="branch-stat-row"><span>Laba</span><strong style={{color:"#22c55e"}}>{fmtRp(b.laba)}</strong></div>
              <div className="branch-stat-row"><span>Transaksi</span><strong>{b.txCount}x</strong></div>
            </div>
          ))}
        </div>
        <div>
          <h3 className="section-title">Best Seller</h3>
          {bs.length===0 && <p className="empty-txt">Belum ada data</p>}
          {bs.map(([nama,qty],i)=>(
            <div key={i} className="bestseller-row">
              <span className="bs-rank">#{i+1}</span>
              <span className="bs-nama">{nama}</span>
              <span className="bs-qty">{qty} pcs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PengeluaranOwner({ pushNotif }) {
  const [date,setDate] = useState(today());
  const getList = () => S.get("pengeluaranOwner")||[];
  const [list,setList] = useState(getList);
  const [form,setForm] = useState({keterangan:"",jumlah:"",kategori:"gaji_pekerja"});
  const refresh = () => setList(getList());

  const KATEGORI = [
    {value:"gaji_pekerja",label:"Gaji Pekerja Lapak"},
    {value:"gaji_kitchen",label:"Gaji Central Kitchen"},
    {value:"bahan_baku",label:"Bahan Baku"},
    {value:"operasional",label:"Operasional"},
    {value:"sewa",label:"Sewa Tempat"},
    {value:"lainnya",label:"Lainnya"},
  ];
  const CHIPS = {
    gaji_pekerja:["Gaji Kasir Pagi","Gaji Kasir Siang","Bonus Pekerja"],
    gaji_kitchen:["Gaji Chef","Gaji Helper","Lembur Kitchen"],
    bahan_baku:["Restok Tepung","Restok Kentang","Restok Minyak","Restok Gas"],
    operasional:["Listrik","Air","Internet"],
    sewa:["Sewa Lapak","Sewa Dapur"],
    lainnya:["Lain-lain"],
  };

  const tambah = () => {
    if(!form.keterangan||!form.jumlah){alert("Isi semua kolom!");return;}
    S.set("pengeluaranOwner",[...(S.get("pengeluaranOwner")||[]),{id:uid(),date,ts:nowTs(),keterangan:form.keterangan,jumlah:parseFloat(form.jumlah),kategori:form.kategori}]);
    setForm(f=>({...f,keterangan:"",jumlah:""}));
    refresh();
    pushNotif("Pengeluaran dicatat!","success");
  };
  const hapus = id => { S.set("pengeluaranOwner",(S.get("pengeluaranOwner")||[]).filter(x=>x.id!==id)); refresh(); };

  const filtered=list.filter(p=>p.date===date);
  const totalHari=filtered.reduce((a,p)=>a+p.jumlah,0);
  const byKat=KATEGORI.map(k=>({...k,total:filtered.filter(p=>p.kategori===k.value).reduce((a,p)=>a+p.jumlah,0)})).filter(k=>k.total>0);

  const lapakList=(S.get("pengeluaranLapak")||[]).filter(p=>p.date===date);
  const branchesData=S.get("branches")||[];

  return (
    <div>
      <div className="filter-bar mb8">
        <input type="date" className="inp inp-sm" value={date} onChange={e=>setDate(e.target.value)} />
      </div>
      <div className="form-card">
        <h4>Tambah Pengeluaran Owner</h4>
        <div className="field-group">
          <label>Kategori</label>
          <select className="inp" value={form.kategori} onChange={e=>setForm(f=>({...f,kategori:e.target.value}))}>
            {KATEGORI.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="chips">
          {(CHIPS[form.kategori]||[]).map(s=><button key={s} className="chip" onClick={()=>setForm(f=>({...f,keterangan:s}))}>{s}</button>)}
        </div>
        <div className="field-group">
          <label>Keterangan</label>
          <input className="inp" value={form.keterangan} onChange={e=>setForm(f=>({...f,keterangan:e.target.value}))} placeholder="Detail pengeluaran..." />
        </div>
        <div className="field-group">
          <label>Jumlah (Rp)</label>
          <input className="inp" type="number" value={form.jumlah} onChange={e=>setForm(f=>({...f,jumlah:e.target.value}))} />
        </div>
        <button className="btn-primary" onClick={tambah}>+ Tambah</button>
      </div>
      {byKat.length>0 && (
        <div className="kpi-grid mt8">
          {byKat.map(k=><div key={k.value} className="kpi-card kpi-peng"><div className="kpi-label">{k.label}</div><div className="kpi-val">{fmtRp(k.total)}</div></div>)}
        </div>
      )}
      <h3 className="section-title mt8">Pengeluaran Owner - {date}</h3>
      {filtered.length===0 && <p className="empty-txt">Belum ada pengeluaran</p>}
      {filtered.map(p=>(
        <div key={p.id} className="peng-row">
          <div className="peng-info"><span className="peng-ket">{p.keterangan}</span><span className="peng-ts">{KATEGORI.find(k=>k.value===p.kategori)?.label} - {p.ts}</span></div>
          <div className="peng-right"><span className="peng-jml">{fmtRp(p.jumlah)}</span><button className="btn-danger-sm" onClick={()=>hapus(p.id)}>X</button></div>
        </div>
      ))}
      {filtered.length>0 && <div className="peng-total">Total: <strong>{fmtRp(totalHari)}</strong></div>}
      <h3 className="section-title mt12">Pengeluaran Lapak dari Pekerja - {date}</h3>
      {lapakList.length===0 && <p className="empty-txt">Tidak ada pengeluaran lapak</p>}
      {lapakList.map(p=>(
        <div key={p.id} className="peng-row">
          <div className="peng-info"><span className="peng-ket">{p.keterangan}</span><span className="peng-ts">{branchesData.find(b=>b.id===p.branchId)?.name||p.branchName} - {p.ts}</span></div>
          <div className="peng-right"><span className="peng-jml">{fmtRp(p.jumlah)}</span></div>
        </div>
      ))}
      {lapakList.length>0 && <div className="peng-total">Total Lapak: <strong>{fmtRp(lapakList.reduce((a,p)=>a+p.jumlah,0))}</strong></div>}
    </div>
  );
}

function OwnerSetoran({ pushNotif }) {
  const [tab,setTab] = useState("harian");
  const [sH,setSH] = useState(()=>S.get("setoranHarian")||[]);
  const [sB,setSB] = useState(()=>S.get("setoranBulanan")||[]);
  const [bulan,setBulan] = useState(today().slice(0,7));
  const branches=S.get("branches")||[];
  const investors=S.get("investors")||[];
  const refresh=()=>{setSH(S.get("setoranHarian")||[]);setSB(S.get("setoranBulanan")||[]);};

  const konfirmasi = id => {
    S.set("setoranHarian",(S.get("setoranHarian")||[]).map(s=>s.id===id?{...s,status:"selesai",konfirmasiTs:nowTs()}:s));
    refresh(); pushNotif("Setoran dikonfirmasi!","success");
  };

  const kirimBulanan = (branchId,investorId) => {
    const txs=S.get("transactions")||[];
    const mTxs=txs.filter(t=>t.branchId===branchId&&t.date.startsWith(bulan));
    const omzet=mTxs.reduce((a,t)=>a+t.total,0);
    const modal=mTxs.reduce((a,t)=>a+t.totalHPP,0);
    const pLapak=(S.get("pengeluaranLapak")||[]).filter(p=>p.branchId===branchId&&p.date.startsWith(bulan)).reduce((a,p)=>a+p.jumlah,0);
    const nBranch=Math.max((S.get("branches")||[]).length,1);
    const pOwner=(S.get("pengeluaranOwner")||[]).filter(p=>p.date.startsWith(bulan)).reduce((a,p)=>a+p.jumlah,0)/nBranch;
    const laba=omzet-modal-pLapak-pOwner;
    const inv=investors.find(i=>i.id===investorId);
    const bagian=laba*((inv?.persenBagi||0)/100);
    const all=S.get("setoranBulanan")||[];
    const ex=all.find(s=>s.branchId===branchId&&s.bulan===bulan&&s.investorId===investorId);
    const entry={id:ex?.id||uid(),branchId,investorId,bulan,omzet,modal,pLapak,pOwner,laba,bagianInvestor:bagian,persen:inv?.persenBagi||0,status:"menunggu",ts:nowTs()};
    S.set("setoranBulanan",ex?all.map(s=>s.id===entry.id?entry:x):[...all,entry]);
    refresh(); pushNotif("Laporan bulanan dikirim!","success");
  };

  const konfirmBulanan = id => {
    S.set("setoranBulanan",(S.get("setoranBulanan")||[]).map(s=>s.id===id?{...s,status:"selesai",konfirmasiTs:nowTs(),confirmedBy:"owner"}:s));
    refresh(); pushNotif("Laporan bulanan dikonfirmasi!","success");
  };

  return (
    <div>
      <div className="tabs">
        <button className={"tab"+(tab==="harian"?" active":"")} onClick={()=>setTab("harian")}>Harian (Pekerja ke Owner)</button>
        <button className={"tab"+(tab==="bulanan"?" active":"")} onClick={()=>setTab("bulanan")}>Bulanan (Owner ke Investor)</button>
      </div>
      {tab==="harian" && (
        <div>
          <h3 className="section-title mt8">Status Setoran Harian</h3>
          {sH.length===0 && <p className="empty-txt">Belum ada setoran masuk</p>}
          {[...sH].reverse().map(s=>{
            const b=branches.find(x=>x.id===s.branchId);
            return (
              <div key={s.id} className={"setoran-card"+(s.status==="menunggu"?" setoran-card-menunggu":s.status==="selesai"?" setoran-card-selesai":"")}>
                <div className="setoran-card-header"><span>{b?.name||s.branchName||s.branchId}</span><span className="setoran-date">{s.date}</span></div>
                <div style={{fontSize:13,color:"#9a9690"}}>Omzet: {fmtRp(s.omzet)} | Pengeluaran: {fmtRp(s.pengeluaran||0)} | Bersih: {fmtRp((s.omzet||0)-(s.pengeluaran||0))}</div>
                <div className="setoran-card-status">
                  {s.status==="menunggu" && <><span className="badge-warn">Menunggu</span><button className="btn-primary btn-sm" onClick={()=>konfirmasi(s.id)}>Konfirmasi</button></>}
                  {s.status==="selesai" && <span className="badge-ok">Dikonfirmasi - {s.konfirmasiTs}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab==="bulanan" && (
        <div>
          <div className="field-group mt8"><label>Pilih Bulan</label><input type="month" className="inp inp-sm" value={bulan} onChange={e=>setBulan(e.target.value)} /></div>
          <h3 className="section-title mt8">Cabang Investasi</h3>
          {branches.filter(b=>b.type==="investasi").length===0 && <p className="empty-txt">Belum ada cabang investasi.</p>}
          {branches.filter(b=>b.type==="investasi").map(b=>{
            const inv=investors.find(i=>i.id===b.investorId);
            const ex=sB.find(s=>s.branchId===b.id&&s.bulan===bulan&&s.investorId===b.investorId);
            return (
              <div key={b.id} className="setoran-card">
                <div className="setoran-card-header"><span>{b.name}</span><span>Investor: {inv?.nama||"-"} ({inv?.persenBagi||0}%)</span></div>
                {ex && <div style={{fontSize:13,color:"#9a9690"}}>Omzet: {fmtRp(ex.omzet)} | HPP: {fmtRp(ex.modal)} | Laba: {fmtRp(ex.laba)} | <strong style={{color:"#f4a227"}}>Bagian Investor: {fmtRp(ex.bagianInvestor)}</strong></div>}
                <div className="setoran-card-status">
                  {!ex && <button className="btn-primary btn-sm" onClick={()=>kirimBulanan(b.id,b.investorId)}>Kirim Laporan</button>}
                  {ex?.status==="menunggu" && <><span className="badge-warn">Menunggu Investor</span><button className="btn-secondary btn-sm" onClick={()=>konfirmBulanan(ex.id)}>Tandai Selesai (Manual)</button></>}
                  {ex?.status==="selesai" && <span className="badge-ok">Dikonfirmasi{ex.confirmedBy?` (${ex.confirmedBy})`:""} - {ex.konfirmasiTs}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OwnerLaporan() {
  const [date,setDate] = useState(today());
  const [selBranch,setSelBranch] = useState("all");
  const branches=S.get("branches")||[];
  const txs=(S.get("transactions")||[]).filter(t=>t.date===date&&(selBranch==="all"||t.branchId===selBranch));
  const pL=(S.get("pengeluaranLapak")||[]).filter(p=>p.date===date&&(selBranch==="all"||p.branchId===selBranch));
  const pO=(S.get("pengeluaranOwner")||[]).filter(p=>p.date===date);
  const editLogs=(S.get("editLog")||[]).filter(l=>selBranch==="all"||l.branchId===selBranch);
  const omzet=txs.reduce((a,t)=>a+t.total,0);
  const modal=txs.reduce((a,t)=>a+t.totalHPP,0);
  const tPL=pL.reduce((a,p)=>a+p.jumlah,0);
  const tPO=pO.reduce((a,p)=>a+p.jumlah,0);
  const laba=omzet-modal-tPL-tPO;
  return (
    <div>
      <div className="filter-bar mb8">
        <input type="date" className="inp inp-sm" value={date} onChange={e=>setDate(e.target.value)} />
        <select className="inp inp-sm" value={selBranch} onChange={e=>setSelBranch(e.target.value)}>
          <option value="all">Semua Cabang</option>
          {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="kpi-grid">
        <div className="kpi-card kpi-omzet"><div className="kpi-label">Omzet</div><div className="kpi-val">{fmtRp(omzet)}</div></div>
        <div className="kpi-card kpi-modal"><div className="kpi-label">HPP Bahan</div><div className="kpi-val">{fmtRp(modal)}</div></div>
        <div className="kpi-card kpi-peng"><div className="kpi-label">Peng. Lapak</div><div className="kpi-val">{fmtRp(tPL)}</div></div>
        <div className="kpi-card kpi-peng"><div className="kpi-label">Peng. Owner</div><div className="kpi-val">{fmtRp(tPO)}</div></div>
        <div className="kpi-card kpi-profit"><div className="kpi-label">Laba Bersih</div><div className="kpi-val">{fmtRp(laba)}</div></div>
      </div>
      {editLogs.length>0 && (
        <div className="mt8">
          <h3 className="section-title">Log Perubahan Kasir</h3>
          {editLogs.map(log=>(
            <div key={log.id} className="log-card">
              <div className="log-header">
                <span>{log.ts}</span>
                <span className="badge-warn">Diedit Kasir</span>
                <span className="badge-branch">{log.branchName||log.branchId}</span>
              </div>
              <div className="log-detail">TX #{log.txId.slice(0,6)} - Alasan: "{log.alasan}"</div>
              <div style={{fontSize:12,color:"#9a9690",marginTop:4}}>
                Sebelum: {(log.before||[]).map(x=>x.nama+" x"+x.qty).join(", ")} - Sesudah: {(log.after||[]).map(x=>x.nama+" x"+x.qty).join(", ")}
              </div>
            </div>
          ))}
        </div>
      )}
      <h3 className="section-title mt8">Detail Transaksi</h3>
      {txs.length===0 && <p className="empty-txt">Belum ada transaksi</p>}
      {txs.map(tx=>(
        <div key={tx.id} className={"tx-card"+(tx.edited?" tx-edited":"")}>
          <div className="tx-header">
            <span className="tx-id">#{tx.id.slice(0,6)}</span>
            <span className="badge-branch">{branches.find(b=>b.id===tx.branchId)?.name||tx.branchId}</span>
            <span className="tx-ts">{tx.ts}</span>
            {tx.edited && <span className="badge-warn">Diedit</span>}
          </div>
          {tx.items.map((it,i)=><div key={i} className="tx-item">{it.nama} x{it.qty} = {fmtRp(it.hargaJual*it.qty)} (HPP: {fmtRp(it.hpp*it.qty)})</div>)}
          <div className="tx-total">Omzet: {fmtRp(tx.total)} | HPP: {fmtRp(tx.totalHPP)} | Laba: {fmtRp(tx.total-tx.totalHPP)}</div>
        </div>
      ))}
      {pL.length>0 && (
        <div className="mt8">
          <h3 className="section-title">Pengeluaran Lapak</h3>
          {pL.map(p=>(
            <div key={p.id} className="peng-row">
              <div className="peng-info"><span className="peng-ket">{p.keterangan}</span><span className="peng-ts">{branches.find(b=>b.id===p.branchId)?.name||p.branchName} - {p.ts}</span></div>
              <div className="peng-right"><span className="peng-jml">{fmtRp(p.jumlah)}</span></div>
            </div>
          ))}
          <div className="peng-total">Total Lapak: <strong>{fmtRp(tPL)}</strong></div>
        </div>
      )}
    </div>
  );
}

function OwnerSetting({ stab, setStab, pushNotif }) {
  const TABS = ["hpp","paket","cabang","akun","investor"];
  const TLABEL = {hpp:"Menu HPP",paket:"Box/Paket",cabang:"Cabang",akun:"Akun",investor:"Investor"};
  return (
    <div>
      <div className="tabs tabs-sm">
        {TABS.map(t=><button key={t} className={"tab"+(stab===t?" active":"")} onClick={()=>setStab(t)}>{TLABEL[t]}</button>)}
      </div>
      {stab==="hpp" && <SettingHPP pushNotif={pushNotif} />}
      {stab==="paket" && <SettingPaket pushNotif={pushNotif} />}
      {stab==="cabang" && <SettingCabang pushNotif={pushNotif} />}
      {stab==="akun" && <SettingAkun pushNotif={pushNotif} />}
      {stab==="investor" && <SettingInvestor pushNotif={pushNotif} />}
    </div>
  );
}

function SettingHPP({ pushNotif }) {
  const [sub,setSub] = useState("bahan");
  const [bahan,setBahan] = useState(()=>S.get("bahanPokok")||[]);
  const [menus,setMenus] = useState(()=>(S.get("menuVarian")||[]).filter(m=>m.tipe!=="paket"));
  const [topings,setTopings] = useState(()=>S.get("topingTambahan")||[]);
  const [editMenu,setEditMenu] = useState(null);
  const [nB,setNB] = useState({nama:"",satuan:"kg",harga:""});
  const [nT,setNT] = useState({nama:"",gram:"",hargaBahan:"",hargaJual:""});

  const saveB=()=>{
    if(!nB.nama||!nB.harga)return;
    const u=[...bahan,{id:uid(),...nB,harga:parseFloat(nB.harga)}];
    S.set("bahanPokok",u);setBahan(u);setNB({nama:"",satuan:"kg",harga:""});pushNotif("Bahan ditambah!","success");
  };
  const delB=id=>{const u=bahan.filter(x=>x.id!==id);S.set("bahanPokok",u);setBahan(u);};

  const saveMenu=m=>{
    const all=S.get("menuVarian")||[];
    const u=all.find(x=>x.id===m.id)?all.map(x=>x.id===m.id?m:x):[...all,{...m,id:uid()}];
    S.set("menuVarian",u);setMenus(u.filter(x=>x.tipe!=="paket"));setEditMenu(null);pushNotif("Menu disimpan!","success");
  };
  const delMenu=id=>{const u=(S.get("menuVarian")||[]).filter(x=>x.id!==id);S.set("menuVarian",u);setMenus(u.filter(x=>x.tipe!=="paket"));};

  const saveT=()=>{
    if(!nT.nama||!nT.gram||!nT.hargaBahan||!nT.hargaJual)return;
    const u=[...topings,{id:uid(),...nT,gram:parseFloat(nT.gram),hargaBahan:parseFloat(nT.hargaBahan),hargaJual:parseFloat(nT.hargaJual)}];
    S.set("topingTambahan",u);setTopings(u);setNT({nama:"",gram:"",hargaBahan:"",hargaJual:""});pushNotif("Toping ditambah!","success");
  };
  const delT=id=>{const u=topings.filter(x=>x.id!==id);S.set("topingTambahan",u);setTopings(u);};

  const SUB_TABS=["bahan","menu","toping"];
  const SUB_LABEL={bahan:"Bahan Pokok",menu:"Varian Menu",toping:"Toping Tambahan"};

  return (
    <div>
      <div className="tabs tabs-sm">
        {SUB_TABS.map(t=><button key={t} className={"tab"+(sub===t?" active":"")} onClick={()=>setSub(t)}>{SUB_LABEL[t]}</button>)}
      </div>
      {sub==="bahan" && (
        <div>
          <h3 className="section-title mt8">Bahan Pokok</h3>
          <p className="info-txt">Harga per satuan. Otomatis dikalkulasi ke HPP berdasarkan gram di resep.</p>
          <table className="tbl mt8">
            <thead><tr><th>Nama</th><th>Satuan</th><th>Harga</th><th></th></tr></thead>
            <tbody>
              {bahan.map(b=><tr key={b.id}><td>{b.nama}</td><td>{b.satuan}</td><td>{fmtRp(b.harga)}</td><td><button className="btn-danger-sm" onClick={()=>delB(b.id)}>Hapus</button></td></tr>)}
            </tbody>
          </table>
          <div className="add-row">
            <input className="inp inp-sm" placeholder="Nama bahan" value={nB.nama} onChange={e=>setNB(x=>({...x,nama:e.target.value}))} />
            <select className="inp inp-sm" value={nB.satuan} onChange={e=>setNB(x=>({...x,satuan:e.target.value}))}>
              <option>kg</option><option>liter</option><option>gram</option><option>tabung</option><option>pcs</option>
            </select>
            <input className="inp inp-sm" type="number" placeholder="Harga" value={nB.harga} onChange={e=>setNB(x=>({...x,harga:e.target.value}))} />
            <button className="btn-primary btn-sm" onClick={saveB}>+ Tambah</button>
          </div>
        </div>
      )}
      {sub==="menu" && (
        <div>
          <h3 className="section-title mt8">Varian Menu Satuan</h3>
          {menus.map(m=>(
            <div key={m.id} className="menu-setting-card">
              <div className="menu-setting-row"><strong>{m.nama}</strong><span>Jual: {fmtRp(m.hargaJual)} | HPP: {fmtRp(hitungHPP(m))}</span></div>
              <div className="menu-setting-actions">
                <button className="btn-secondary btn-sm" onClick={()=>setEditMenu({...m})}>Edit</button>
                <button className="btn-danger-sm" onClick={()=>delMenu(m.id)}>Hapus</button>
              </div>
            </div>
          ))}
          <button className="btn-primary mt8" onClick={()=>setEditMenu({id:null,nama:"",tipe:"satuan",hargaJual:"",resepBahanPokok:[],resepToping:[]})}>+ Tambah Menu</button>
          {editMenu && <EditMenuModal menu={editMenu} bahan={bahan} onSave={saveMenu} onClose={()=>setEditMenu(null)} />}
        </div>
      )}
      {sub==="toping" && (
        <div>
          <h3 className="section-title mt8">Toping Tambahan</h3>
          <p className="info-txt">HPP toping saja, tidak termasuk bahan pokok.</p>
          <table className="tbl mt8">
            <thead><tr><th>Nama</th><th>Gram</th><th>HPP</th><th>Jual</th><th></th></tr></thead>
            <tbody>
              {topings.map(t=><tr key={t.id}><td>{t.nama}</td><td>{t.gram}g</td><td>{fmtRp(t.hargaBahan)}</td><td>{fmtRp(t.hargaJual)}</td><td><button className="btn-danger-sm" onClick={()=>delT(t.id)}>Hapus</button></td></tr>)}
            </tbody>
          </table>
          <div className="add-row">
            <input className="inp inp-sm" placeholder="Nama" value={nT.nama} onChange={e=>setNT(x=>({...x,nama:e.target.value}))} />
            <input className="inp inp-sm" type="number" placeholder="Gram" value={nT.gram} onChange={e=>setNT(x=>({...x,gram:e.target.value}))} />
            <input className="inp inp-sm" type="number" placeholder="HPP (Rp)" value={nT.hargaBahan} onChange={e=>setNT(x=>({...x,hargaBahan:e.target.value}))} />
            <input className="inp inp-sm" type="number" placeholder="Jual (Rp)" value={nT.hargaJual} onChange={e=>setNT(x=>({...x,hargaJual:e.target.value}))} />
            <button className="btn-primary btn-sm" onClick={saveT}>+ Tambah</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingPaket({ pushNotif }) {
  const [pakets,setPakets] = useState(()=>(S.get("menuVarian")||[]).filter(m=>m.tipe==="paket"));
  const [bahan] = useState(()=>S.get("bahanPokok")||[]);
  const [editP,setEditP] = useState(null);
  const save=m=>{
    const all=S.get("menuVarian")||[];
    const u=all.find(x=>x.id===m.id)?all.map(x=>x.id===m.id?m:x):[...all,{...m,id:uid()}];
    S.set("menuVarian",u);setPakets(u.filter(x=>x.tipe==="paket"));setEditP(null);pushNotif("Box disimpan!","success");
  };
  const del=id=>{const u=(S.get("menuVarian")||[]).filter(x=>x.id!==id);S.set("menuVarian",u);setPakets(u.filter(x=>x.tipe==="paket"));};
  return (
    <div>
      <h3 className="section-title mt8">Box / Paket</h3>
      <p className="info-txt">Menu dijual per box. Resep = total bahan untuk satu box.</p>
      {pakets.map(p=>(
        <div key={p.id} className="menu-setting-card">
          <div className="menu-setting-row">
            <strong>{p.nama}</strong>
            <span className="badge-paket">Isi {p.isiBox} pcs</span>
            <span>Jual: {fmtRp(p.hargaJual)} | HPP: {fmtRp(hitungHPP(p))}</span>
          </div>
          <div className="menu-setting-actions">
            <button className="btn-secondary btn-sm" onClick={()=>setEditP({...p})}>Edit</button>
            <button className="btn-danger-sm" onClick={()=>del(p.id)}>Hapus</button>
          </div>
        </div>
      ))}
      <button className="btn-primary mt8" onClick={()=>setEditP({id:null,nama:"",tipe:"paket",isiBox:3,hargaJual:"",resepBahanPokok:[],resepToping:[]})}>+ Tambah Box</button>
      {editP && <EditMenuModal menu={editP} bahan={bahan} isPaket onSave={save} onClose={()=>setEditP(null)} />}
    </div>
  );
}

function EditMenuModal({ menu, bahan, isPaket, onSave, onClose }) {
  const [m,setM] = useState({...menu,tipe:isPaket?"paket":"satuan",resepBahanPokok:menu.resepBahanPokok||[],resepToping:menu.resepToping||[]});
  const [nRB,setNRB] = useState({bahanId:bahan[0]?.id||"",gram:""});
  const [nRT,setNRT] = useState({nama:"",gram:"",harga:""});
  const addRB=()=>{if(!nRB.bahanId||!nRB.gram)return;setM(p=>({...p,resepBahanPokok:[...p.resepBahanPokok,{bahanId:nRB.bahanId,gram:parseFloat(nRB.gram)}]}));setNRB(x=>({...x,gram:""}));};
  const delRB=i=>setM(p=>({...p,resepBahanPokok:p.resepBahanPokok.filter((_,idx)=>idx!==i)}));
  const addRT=()=>{if(!nRT.nama||!nRT.gram||!nRT.harga)return;setM(p=>({...p,resepToping:[...p.resepToping,{nama:nRT.nama,gram:parseFloat(nRT.gram),harga:parseFloat(nRT.harga)}]}));setNRT({nama:"",gram:"",harga:""});};
  const delRT=i=>setM(p=>({...p,resepToping:p.resepToping.filter((_,idx)=>idx!==i)}));
  const hpp=hitungHPP(m);
  return (
    <Modal title={(isPaket?"Box - ":"Menu - ")+(m.id?"Edit":"Tambah")} onClose={onClose}>
      <div className="field-group"><label>Nama</label><input className="inp" value={m.nama} onChange={e=>setM(x=>({...x,nama:e.target.value}))} /></div>
      {isPaket && <div className="field-group"><label>Isi Box (pcs)</label><input className="inp" type="number" value={m.isiBox||3} onChange={e=>setM(x=>({...x,isiBox:parseInt(e.target.value)||3}))} /></div>}
      <div className="field-group"><label>Harga Jual</label><input className="inp" type="number" value={m.hargaJual} onChange={e=>setM(x=>({...x,hargaJual:parseFloat(e.target.value)||0}))} /></div>
      <h4 className="sub-title">Resep Bahan Pokok {isPaket?"(total untuk "+m.isiBox+" pcs)":""}</h4>
      {m.resepBahanPokok.map((r,i)=>{
        const b=bahan.find(x=>x.id===r.bahanId);
        return <div key={i} className="resep-row">{b?.nama} - {r.gram}g <button className="btn-danger-sm" onClick={()=>delRB(i)}>X</button></div>;
      })}
      <div className="add-row">
        <select className="inp inp-sm" value={nRB.bahanId} onChange={e=>setNRB(x=>({...x,bahanId:e.target.value}))}>
          {bahan.map(b=><option key={b.id} value={b.id}>{b.nama}</option>)}
        </select>
        <input className="inp inp-sm" type="number" placeholder="Gram" value={nRB.gram} onChange={e=>setNRB(x=>({...x,gram:e.target.value}))} />
        <button className="btn-primary btn-sm" onClick={addRB}>+</button>
      </div>
      <h4 className="sub-title">Toping Menu</h4>
      {m.resepToping.map((t,i)=><div key={i} className="resep-row">{t.nama} - {t.gram}g - {fmtRp(t.harga)} <button className="btn-danger-sm" onClick={()=>delRT(i)}>X</button></div>)}
      <div className="add-row">
        <input className="inp inp-sm" placeholder="Nama toping" value={nRT.nama} onChange={e=>setNRT(x=>({...x,nama:e.target.value}))} />
        <input className="inp inp-sm" type="number" placeholder="Gram" value={nRT.gram} onChange={e=>setNRT(x=>({...x,gram:e.target.value}))} />
        <input className="inp inp-sm" type="number" placeholder="Harga (Rp)" value={nRT.harga} onChange={e=>setNRT(x=>({...x,harga:e.target.value}))} />
        <button className="btn-primary btn-sm" onClick={addRT}>+</button>
      </div>
      <div className="hpp-preview">HPP: <strong>{fmtRp(hpp)}</strong> | Margin: <strong>{fmtRp((m.hargaJual||0)-hpp)}</strong>{isPaket?" | Per pcs: "+fmtRp(Math.ceil(hpp/(m.isiBox||3))):""}</div>
      <div className="row-wrap mt8">
        <button className="btn-secondary" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={()=>{if(!m.nama){alert("Isi nama!");return;}onSave(m);}}>Simpan</button>
      </div>
    </Modal>
  );
}

function SettingCabang({ pushNotif }) {
  const [branches,setBranches] = useState(()=>S.get("branches")||[]);
  const investors=S.get("investors")||[];
  const [form,setForm] = useState({nama:"",type:"mandiri",investorId:"",workers:""});
  const [editB,setEditB] = useState(null);

  const add=()=>{
    if(!form.nama)return;
    const wArr=form.workers.split(",").map(s=>s.trim()).filter(Boolean);
    const u=[...branches,{id:uid(),name:form.nama,type:form.type,investorId:form.type==="investasi"?form.investorId:null,workers:wArr}];
    S.set("branches",u);setBranches(u);setForm({nama:"",type:"mandiri",investorId:"",workers:""});pushNotif("Cabang ditambahkan!","success");
  };
  const saveEdit=()=>{
    const wArr=editB.ws.split(",").map(s=>s.trim()).filter(Boolean);
    const u=branches.map(b=>b.id===editB.id?{...b,name:editB.name,workers:wArr,type:editB.type,investorId:editB.type==="investasi"?editB.investorId:null}:b);
    S.set("branches",u);setBranches(u);setEditB(null);pushNotif("Cabang diperbarui!","success");
  };
  const del=id=>{const u=branches.filter(x=>x.id!==id);S.set("branches",u);setBranches(u);};

  return (
    <div>
      <h3 className="section-title mt8">Kelola Cabang</h3>
      {branches.map(b=>(
        <div key={b.id} className="branch-row">
          <div style={{flex:1}}>
            <strong>{b.name}</strong> <span className={"badge-type "+b.type}>{b.type}</span>
            {b.workers?.length>0 && <div className="branch-workers">{b.workers.join(", ")}</div>}
            {b.type==="investasi" && <div style={{fontSize:12,color:"#9a9690"}}>Investor: {investors.find(i=>i.id===b.investorId)?.nama||"-"}</div>}
          </div>
          <button className="btn-secondary btn-sm" onClick={()=>setEditB({...b,ws:(b.workers||[]).join(", ")})}>Edit</button>
          <button className="btn-danger-sm" onClick={()=>del(b.id)}>Hapus</button>
        </div>
      ))}
      {editB && (
        <Modal title="Edit Cabang" onClose={()=>setEditB(null)}>
          <div className="field-group"><label>Nama Cabang</label><input className="inp" value={editB.name} onChange={e=>setEditB(x=>({...x,name:e.target.value}))} /></div>
          <div className="field-group"><label>Nama Pekerja (pisah koma)</label><input className="inp" value={editB.ws} onChange={e=>setEditB(x=>({...x,ws:e.target.value}))} placeholder="Andi, Sari, Budi" /></div>
          <div className="field-group"><label>Tipe</label>
            <div className="role-tabs">
              <button className={"role-tab"+(editB.type==="mandiri"?" active":"")} onClick={()=>setEditB(x=>({...x,type:"mandiri"}))}>Mandiri</button>
              <button className={"role-tab"+(editB.type==="investasi"?" active":"")} onClick={()=>setEditB(x=>({...x,type:"investasi"}))}>Investasi</button>
            </div>
          </div>
          {editB.type==="investasi" && (
            <div className="field-group"><label>Investor</label>
              <select className="inp" value={editB.investorId} onChange={e=>setEditB(x=>({...x,investorId:e.target.value}))}>
                <option value="">-- Pilih --</option>
                {investors.map(i=><option key={i.id} value={i.id}>{i.nama} ({i.persenBagi}%)</option>)}
              </select>
            </div>
          )}
          <div className="row-wrap mt8">
            <button className="btn-secondary" onClick={()=>setEditB(null)}>Batal</button>
            <button className="btn-primary" onClick={saveEdit}>Simpan</button>
          </div>
        </Modal>
      )}
      <div className="form-card mt12">
        <h4>Tambah Cabang Baru</h4>
        <div className="field-group"><label>Nama Cabang</label><input className="inp" value={form.nama} onChange={e=>setForm(x=>({...x,nama:e.target.value}))} /></div>
        <div className="field-group"><label>Nama Pekerja (pisah koma)</label><input className="inp" value={form.workers} onChange={e=>setForm(x=>({...x,workers:e.target.value}))} placeholder="Andi, Sari" /></div>
        <div className="field-group"><label>Tipe</label>
          <div className="role-tabs">
            <button className={"role-tab"+(form.type==="mandiri"?" active":"")} onClick={()=>setForm(x=>({...x,type:"mandiri"}))}>Mandiri</button>
            <button className={"role-tab"+(form.type==="investasi"?" active":"")} onClick={()=>setForm(x=>({...x,type:"investasi"}))}>Investasi</button>
          </div>
        </div>
        {form.type==="investasi" && (
          <div className="field-group"><label>Investor</label>
            <select className="inp" value={form.investorId} onChange={e=>setForm(x=>({...x,investorId:e.target.value}))}>
              <option value="">-- Pilih --</option>
              {investors.map(i=><option key={i.id} value={i.id}>{i.nama} ({i.persenBagi}%)</option>)}
            </select>
          </div>
        )}
        <button className="btn-primary" onClick={add}>+ Tambah Cabang</button>
      </div>
    </div>
  );
}

function SettingAkun({ pushNotif }) {
  const tick = useStoreTick();
  const branches = S.get("branches") || [];
  const investors = S.get("investors") || [];
  const profiles = S.get("profiles") || [];

  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    role: "worker",
    email: "",
    displayName: "",
    branchId: branches[0]?.id || "",
    investorId: investors[0]?.id || "",
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
    const email = String(form.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) { alert("Email tidak valid."); return; }

    if (form.role === "worker" && !form.branchId) { alert("Pilih cabang untuk pekerja."); return; }
    if (form.role === "investor" && !form.investorId) { alert("Pilih investor (buat dulu di tab Investor)."); return; }

    const payload = {
      email,
      role: form.role,
      displayName: String(form.displayName || "").trim() || null,
      branchId: form.role === "worker" ? form.branchId : null,
      investorId: form.role === "investor" ? form.investorId : null,
    };

    try {
      const { error } = await sb.from("invites").insert(payload);
      if (error) throw error;
      pushNotif("Invite dibuat. Sekarang kamu bisa daftarkan akun ini di Supabase Auth.", "success");
      setForm((f) => ({ ...f, email: "", displayName: "" }));
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

  return (
    <div>
      <h3 className="section-title mt8">Akun & Invite</h3>
      <p className="info-txt">
        Owner membuat invite (role + cabang). Daftarkan email tersebut manual di Supabase Auth agar password bisa ditentukan langsung tanpa kirim link.
      </p>

      <div className="form-card mt8">
        <h4>Buat Invite</h4>
        <div className="field-group">
          <label>Role</label>
          <div className="role-tabs">
            <button className={"role-tab"+(form.role==="worker"?" active":"")} onClick={()=>setForm(f=>({...f,role:"worker"}))}>Pekerja</button>
            <button className={"role-tab"+(form.role==="investor"?" active":"")} onClick={()=>setForm(f=>({...f,role:"investor"}))}>Investor</button>
            <button className={"role-tab"+(form.role==="owner"?" active":"")} onClick={()=>setForm(f=>({...f,role:"owner"}))}>Owner</button>
          </div>
        </div>
        <div className="field-group">
          <label>Email / Username Internal</label>
          <input className="inp" value={form.email} onChange={(e)=>setForm(f=>({...f,email:e.target.value}))} placeholder="nama_user atau nama@email.com" />
        </div>
        <div className="field-group">
          <label>Nama Tampilan (opsional)</label>
          <input className="inp" value={form.displayName} onChange={(e)=>setForm(f=>({...f,displayName:e.target.value}))} placeholder="Andi / Sari / Pak Budi" />
        </div>

        {form.role === "worker" && (
          <div className="field-group">
            <label>Cabang</label>
            <select className="inp" value={form.branchId} onChange={(e)=>setForm(f=>({...f,branchId:e.target.value}))}>
              <option value="">-- Pilih --</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        {form.role === "investor" && (
          <>
            <div className="field-group">
              <label>Pilih Investor</label>
              <select className="inp" value={form.investorId} onChange={(e)=>setForm(f=>({...f,investorId:e.target.value}))}>
                <option value="">-- Pilih --</option>
                {investors.map(i => <option key={i.id} value={i.id}>{i.nama} ({i.persenBagi}%)</option>)}
              </select>
              {investors.length===0 && <p className="info-txt mt8">Belum ada investor. Buat dulu di tab Investor.</p>}
            </div>
          </>
        )}

        <button className="btn-primary" onClick={createInvite}>+ Buat Invite</button>
      </div>

      <h3 className="section-title mt12">Daftar Invite</h3>
      {loading && <p className="info-txt">Memuat...</p>}
      {!loading && invites.length===0 && <p className="empty-txt">Belum ada invite.</p>}
      {!loading && invites.map(iv => (
        <div key={iv.id} className="investor-row">
          <div style={{flex:1}}>
            <strong>{iv.email}</strong>
            <div style={{fontSize:12,color:"#9a9690"}}>
              Role: {iv.role}{iv.branchId ? ` | Cabang: ${branches.find(b=>b.id===iv.branchId)?.name||iv.branchId}` : ""}
              {iv.investorId ? ` | Investor: ${investors.find(i=>i.id===iv.investorId)?.nama||iv.investorId}` : ""}
            </div>
          </div>
          <div className="row-wrap">
            <button className="btn-danger-sm" onClick={()=>deleteInvite(iv.id)}>Hapus</button>
          </div>
        </div>
      ))}

      <h3 className="section-title mt12">Akun Terdaftar</h3>
      {profiles.length===0 && <p className="empty-txt">Belum ada data profiles (pastikan kamu login sebagai Owner).</p>}
      {profiles.length>0 && profiles.map(p => (
        <div key={p.user_id} className="branch-row">
          <div style={{flex:1}}>
            <strong>{p.display_name || p.email || p.user_id.slice(0,8)}</strong>
            <div style={{fontSize:12,color:"#9a9690"}}>
              Role: {p.role}
              {p.branchId ? ` | Cabang: ${branches.find(b=>b.id===p.branchId)?.name||p.branchId}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingInvestor({ pushNotif }) {
  const [investors,setInvestors] = useState(()=>S.get("investors")||[]);
  const [form,setForm] = useState({nama:"",persenBagi:""});
  const add=()=>{
    if(!form.nama||!form.persenBagi)return;
    const u=[...investors,{id:uid(),nama:form.nama,persenBagi:parseFloat(form.persenBagi)}];
    S.set("investors",u);setInvestors(u);setForm({nama:"",persenBagi:""});pushNotif("Investor ditambahkan!","success");
  };
  const del=id=>{const u=investors.filter(x=>x.id!==id);S.set("investors",u);setInvestors(u);};
  const upP=(id,p)=>{const u=investors.map(x=>x.id===id?{...x,persenBagi:parseFloat(p)||0}:x);S.set("investors",u);setInvestors(u);};
  return (
    <div>
      <h3 className="section-title mt8">Kelola Investor</h3>
      {investors.map(inv=>(
        <div key={inv.id} className="investor-row">
          <strong>{inv.nama}</strong>
          <div className="row-wrap">
            <input className="inp inp-sm" type="number" value={inv.persenBagi} onChange={e=>upP(inv.id,e.target.value)} style={{width:70}} />
            <span>%</span>
            <button className="btn-danger-sm" onClick={()=>del(inv.id)}>Hapus</button>
          </div>
        </div>
      ))}
      <div className="form-card mt12">
        <h4>Tambah Investor</h4>
        <div className="field-group"><label>Nama</label><input className="inp" value={form.nama} onChange={e=>setForm(x=>({...x,nama:e.target.value}))} /></div>
        <div className="field-group"><label>% Bagi Hasil</label><input className="inp" type="number" value={form.persenBagi} onChange={e=>setForm(x=>({...x,persenBagi:e.target.value}))} /></div>
        <button className="btn-primary" onClick={add}>+ Tambah</button>
      </div>
    </div>
  );
}

// INVESTOR
function InvestorPage({ investorId, pushNotif, me }) {
  const tick = useStoreTick(); // agar rerender saat realtime update
  const [tab,setTab] = useState("harian");
  const [selDate,setSelDate] = useState(today());
  const [month,setMonth] = useState(today().slice(0,7));
  const investors=S.get("investors")||[];
  const invMe = investors.find(i => i.id === investorId);
  const branches=(S.get("branches")||[]).filter(b=>b.type==="investasi" && (!investorId || b.investorId===investorId));
  const txs=S.get("transactions")||[];
  const pLapak=S.get("pengeluaranLapak")||[];
  const setoranBul=(S.get("setoranBulanan")||[]).filter(s=>s.bulan===month && (!investorId || s.investorId===investorId));

  const konfirmBulananInvestor = (id) => {
    const all = S.get("setoranBulanan") || [];
    const target = all.find(x=>x.id===id);
    if (!target) { alert("Data laporan tidak ditemukan."); return; }
    if (investorId && target.investorId !== investorId) { alert("Tidak punya akses untuk laporan ini."); return; }
    S.set("setoranBulanan", all.map(s => s.id===id ? { ...s, status:"selesai", konfirmasiTs: nowTs(), confirmedBy:"investor" } : s));
    pushNotif?.("Laporan bulanan dikonfirmasi.","success");
  };

  const chart7=[];
  for(let i=6;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const ds=d.toISOString().slice(0,10);
    const dTxs=txs.filter(t=>branches.some(b=>b.id===t.branchId)&&t.date===ds);
    chart7.push({label:ds.slice(5),v1:dTxs.reduce((a,t)=>a+t.total,0),v2:dTxs.reduce((a,t)=>a+t.totalHPP,0)});
  }
  const branchChart=branches.map(b=>({
    label:b.name.slice(0,8),
    v1:txs.filter(t=>t.branchId===b.id).reduce((a,t)=>a+t.total,0),
    v2:txs.filter(t=>t.branchId===b.id).reduce((a,t)=>a+t.totalHPP,0),
  }));

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-icon">I</span>
        <div><h2>Portal Investor</h2><p className="page-sub">{invMe?.nama?`Akun: ${invMe.nama}`:"Cabang Investasi Saja"}</p></div>
      </div>
      <div className="tabs">
        <button className={"tab"+(tab==="harian"?" active":"")} onClick={()=>setTab("harian")}>Laporan Harian</button>
        <button className={"tab"+(tab==="bulanan"?" active":"")} onClick={()=>setTab("bulanan")}>Laporan Bulanan</button>
      </div>

      {tab==="harian" && (
        <div>
          <div className="field-group mt8">
            <label>Pilih Tanggal</label>
            <input type="date" className="inp inp-sm" value={selDate} onChange={e=>setSelDate(e.target.value)} />
          </div>
          {branches.length===0 && <p className="empty-txt">Belum ada cabang investasi.</p>}
          {branches.map(b=>{
            const inv=investors.find(i=>i.id===b.investorId);
            const dayTxs=txs.filter(t=>t.branchId===b.id&&t.date===selDate);
            const peng=pLapak.filter(p=>p.branchId===b.id&&p.date===selDate).reduce((a,p)=>a+p.jumlah,0);
            const omzet=dayTxs.reduce((a,t)=>a+t.total,0);
            const modal=dayTxs.reduce((a,t)=>a+t.totalHPP,0);
            const laba=omzet-modal-peng;
            const est=laba*((inv?.percentBagi||0)/100);
            return (
              <div key={b.id} className="investor-report-card">
                <div className="investor-report-header">
                  <h3>{b.name}</h3>
                  <span className="badge-type investasi">Investasi</span>
                </div>
                <div className="investor-report-inv">Investor: {inv?.nama||"-"} | Bagi Hasil: {inv?.persenBagi||0}%</div>
                <div className="investor-kpi-grid">
                  <div className="inv-kpi"><div className="kpi-label">Omzet</div><div className="kpi-val-sm">{fmtRp(omzet)}</div></div>
                  <div className="inv-kpi"><div className="kpi-label">HPP</div><div className="kpi-val-sm">{fmtRp(modal)}</div></div>
                  <div className="inv-kpi"><div className="kpi-label">Pengeluaran</div><div className="kpi-val-sm">{fmtRp(peng)}</div></div>
                  <div className="inv-kpi"><div className="kpi-label">Laba</div><div className="kpi-val-sm">{fmtRp(laba)}</div></div>
                  <div className="inv-kpi inv-kpi-hl" style={{gridColumn:"1/-1"}}>
                    <div className="kpi-label">Est. Bagian Anda ({inv?.persenBagi||0}%)</div>
                    <div className="kpi-val-sm">{fmtRp(est)}</div>
                  </div>
                </div>
                <h4 className="sub-title">Transaksi ({dayTxs.length}x)</h4>
                {dayTxs.length===0 && <p className="empty-txt">Belum ada transaksi</p>}
                {dayTxs.slice(0,5).map(tx=>(
                  <div key={tx.id} className="tx-card">
                    <div className="tx-header"><span className="tx-id">#{tx.id.slice(0,6)}</span><span className="tx-ts">{tx.ts}</span></div>
                    {tx.items.map((it,i)=><div key={i} className="tx-item">{it.nama} x{it.qty} - {fmtRp(it.hargaJual*it.qty)}</div>)}
                    <div className="tx-total">Total: {fmtRp(tx.total)}</div>
                  </div>
                ))}
                {dayTxs.length>5 && <p className="info-txt">+{dayTxs.length-5} transaksi lainnya</p>}
              </div>
            );
          })}
          {branches.length>0 && (
            <div className="chart-box mt8">
              <h3 className="section-title">Omzet 7 Hari - Cabang Investasi</h3>
              <BarChart data={chart7} height={90} />
              <div className="chart-legend mt8">
                <span className="leg-dot leg-a"></span><span>Omzet</span>
                <span className="leg-dot leg-b" style={{marginLeft:12}}></span><span>HPP</span>
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="bulanan" && (
        <div>
          <div className="field-group mt8">
            <label>Pilih Bulan</label>
            <input type="month" className="inp inp-sm" value={month} onChange={e=>setMonth(e.target.value)} />
          </div>
          {branches.length===0 && <p className="empty-txt">Belum ada cabang investasi.</p>}
          {branches.map(b=>{
            const inv=investors.find(i=>i.id===b.investorId);
            const laporan=setoranBul.find(s=>s.branchId===b.id&&s.investorId===b.investorId);
            return (
              <div key={b.id} className="investor-report-card">
                <div className="investor-report-header">
                  <h3>{b.name}</h3>
                  <span className="badge-type investasi">Investasi</span>
                </div>
                <div className="investor-report-inv">Investor: {inv?.nama||"-"} | Bagi Hasil: {inv?.persenBagi||0}%</div>
                {!laporan && <p className="empty-txt">Laporan bulan ini belum dikirim Owner.</p>}
                {laporan && (
                  <div>
                    <div className="investor-kpi-grid">
                      <div className="inv-kpi"><div className="kpi-label">Omzet</div><div className="kpi-val-sm">{fmtRp(laporan.omzet)}</div></div>
                      <div className="inv-kpi"><div className="kpi-label">HPP</div><div className="kpi-val-sm">{fmtRp(laporan.modal)}</div></div>
                      <div className="inv-kpi"><div className="kpi-label">Pengeluaran</div><div className="kpi-val-sm">{fmtRp((laporan.pLapak||0)+(laporan.pOwner||0))}</div></div>
                      <div className="inv-kpi"><div className="kpi-label">Laba Bersih</div><div className="kpi-val-sm">{fmtRp(laporan.laba)}</div></div>
                      <div className="inv-kpi inv-kpi-hl" style={{gridColumn:"1/-1"}}>
                        <div className="kpi-label">Bagian Anda ({laporan.persen}%)</div>
                        <div className="kpi-val-sm">{fmtRp(laporan.bagianInvestor)}</div>
                      </div>
                    </div>
                    <div className={"setoran-status setoran-"+laporan.status} style={{marginTop:10}}>
                      {laporan.status==="menunggu" && (
                        <>
                          <span>Laporan diterima, menunggu konfirmasi Anda</span>
                          <div className="row-wrap mt8">
                            <button className="btn-primary btn-sm" onClick={()=>konfirmBulananInvestor(laporan.id)}>Konfirmasi</button>
                          </div>
                        </>
                      )}
                      {laporan.status==="selesai" && <span>Dikonfirmasi - {laporan.konfirmasiTs}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {branchChart.length>0 && (
            <div className="chart-box mt8">
              <h3 className="section-title">Omzet Per Cabang Investasi</h3>
              <BarChart data={branchChart} height={90} />
              <div className="chart-legend mt8">
                <span className="leg-dot leg-a"></span><span>Omzet</span>
                <span className="leg-dot leg-b" style={{marginLeft:12}}></span><span>HPP</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// APP ROOT
function App() {
  const [authSession, setAuthSession] = useState(null);
  const [profile, setProfile] = useState(null); // row dari public.profiles
  const [loading, setLoading] = useState(true);
  const [notifs,setNotifs] = useState([]);
  const pushNotif = useCallback((msg,type="success")=>{const id=uid();setNotifs(n=>[...n,{id,msg,type}]);},[]);
  const removeNotif = useCallback(id=>setNotifs(n=>n.filter(x=>x.id!==id)),[]);

  // Kirim error dari Store ke notifikasi UI
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
      const { data: prof, error } = await sb
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .single();
      if (error) throw error;

      if (!prof || prof.role === "none") {
        pushNotif("Akun kamu belum diundang oleh Owner (akses ditolak).", "warning");
        await sb.auth.signOut();
        return;
      }

      setProfile(prof);

      // Load data sesuai RLS (worker/investor akan otomatis terbatas)
      await S.loadAll();

      // Owner bisa melihat daftar akun (profiles)
      if (prof.role === "owner") {
        await S.loadKey("profiles").catch(() => {});
      }

      S.startRealtime();
    } catch (ex) {
      pushNotif(ex?.message || String(ex), "warning");
    } finally {
      setLoading(false);
    }
  }, [pushNotif]);

  // Init auth listener + detect session dari login redirect
  useEffect(() => {
    let unsub = null;
    sb.auth.getSession().then(({ data }) => syncAfterLogin(data?.session || null));
    const { data } = sb.auth.onAuthStateChange((_event, session) => syncAfterLogin(session));
    unsub = data?.subscription;
    return () => {
      try { unsub?.unsubscribe(); } catch {}
    };
  }, [syncAfterLogin]);

  return (
    <>
      {!authSession ? (
        <LoginPage />
      ) : (
        <div className="app-wrap">
          <nav className="top-nav">
            <span className="nav-brand">DonatBoss</span>
            <span className="nav-role">
              {profile?.role==="owner"?"Owner":profile?.role==="worker"?"Pekerja":profile?.role==="investor"?"Investor":"—"}
            </span>
            <button className="btn-logout" onClick={()=>sb.auth.signOut()}>Keluar</button>
          </nav>
          <div className="content-wrap">
            {loading && <p className="info-txt">Memuat data...</p>}
            {!loading && profile?.role==="worker" && <WorkerPage pushNotif={pushNotif} me={profile} />}
            {!loading && profile?.role==="owner" && <OwnerPage pushNotif={pushNotif} me={profile} />}
            {!loading && profile?.role==="investor" && <InvestorPage investorId={profile.investorId} pushNotif={pushNotif} me={profile} />}
          </div>
        </div>
      )}
      <div className="notif-stack">
        {notifs.map(n=><Notif key={n.id} msg={n.msg} type={n.type} onClose={()=>removeNotif(n.id)} />)}
      </div>
    </>
  );
}

// Mount ke halaman (GitHub Pages / file HTML biasa)
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
