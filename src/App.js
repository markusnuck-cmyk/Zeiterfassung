import React, { useState, useEffect, useRef, useCallback } from 'react';

const TYPES       = ["work","pause","travel","sick","accident","other","vacation","holiday"];
const TYPE_LABELS = { work:"Arbeitszeit", pause:"Pause", travel:"Reisezeit", sick:"Krank", accident:"Unfall", other:"Sonstiges", vacation:"Ferien", holiday:"Feiertag" };
const TYPE_COLORS = { work:"#22c55e", pause:"#f59e0b", travel:"#3b82f6", sick:"#f87171", accident:"#fb923c", other:"#a78bfa", vacation:"#06b6d4", holiday:"#e879f9" };
const TYPE_ICONS  = { work:"⚒", pause:"⏸", travel:"✈", sick:"🤒", accident:"⚠", other:"📝", vacation:"🏖", holiday:"🎉" };
const NEEDS_LOC   = new Set(["work","travel"]);
const NEEDS_NOTE  = new Set(["other"]);
const ADMIN_PIN   = "4774";

function getSwissHolidays(year) {
  const fixed = [
    {date:`${year}-01-01`,name:"Neujahr"},{date:`${year}-01-02`,name:"Berchtoldstag"},
    {date:`${year}-05-01`,name:"Tag der Arbeit"},{date:`${year}-08-01`,name:"Bundesfeiertag"},
    {date:`${year}-12-25`,name:"Weihnachten"},{date:`${year}-12-26`,name:"Stephanstag"},
  ];
  function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;return new Date(y,month-1,day);}
  function add(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r.toISOString().slice(0,10);}
  const e=easter(year);
  return [...fixed,{date:add(e,-2),name:"Karfreitag"},{date:add(e,1),name:"Ostermontag"},{date:add(e,39),name:"Auffahrt"},{date:add(e,50),name:"Pfingstmontag"}].sort((a,b)=>a.date.localeCompare(b.date));
}

function msToH(ms){return ms>0?(ms/3600000).toFixed(2).replace(/\.00$/,""):"0";}
function formatH(ms){if(!ms||ms<=0)return"–";const h=ms/3600000;return h%1===0?`${h}h`:`${h.toFixed(2)}h`;}
function hToMs(h){return Math.round(parseFloat(h)*3600000);}
function today(){return new Date().toISOString().slice(0,10);}
function fDate(d){return new Date(d+"T12:00:00").toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit",year:"2-digit"});}
function locColor(n){if(!n)return"#555";const c=["#818cf8","#34d399","#f472b6","#fb923c","#a78bfa","#38bdf8","#4ade80","#fbbf24","#f87171","#2dd4bf"];let h=0;for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))%c.length;return c[h];}
function hashPin(p){let h=0;for(let i=0;i<p.length;i++)h=(Math.imul(31,h)+p.charCodeAt(i))|0;return h.toString(36);}
function daysInRange(from,to){const days=[];const d=new Date(from+"T12:00:00");const end=new Date(to+"T12:00:00");while(d<=end){days.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}return days;}

function createClient(url, key) {
  const headers = { "Content-Type":"application/json", "apikey":key, "Authorization":`Bearer ${key}` };
  async function query(table, options={}) {
    let path = `${url}/rest/v1/${table}?`;
    if (options.select) path += `select=${options.select}&`;
    if (options.filter) path += `${options.filter}&`;
    if (options.order)  path += `order=${options.order}&`;
    const res = await fetch(path, { headers: {...headers, "Prefer":"return=representation"} });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function insert(table, data) {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method:"POST", headers:{...headers,"Prefer":"return=representation"},
      body: JSON.stringify(Array.isArray(data)?data:[data])
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function update(table, filter, data) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method:"PATCH", headers:{...headers,"Prefer":"return=representation"},
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  async function remove(table, filter) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, { method:"DELETE", headers });
    if (!res.ok) throw new Error(await res.text());
    return true;
  }
  async function upsert(table, data, onConflict) {
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method:"POST", headers:{...headers,"Prefer":"return=representation,resolution=merge-duplicates"},
      body: JSON.stringify(Array.isArray(data)?data:[data])
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  return { query, insert, update, remove, upsert };
}

function loadConfig(){try{const r=localStorage.getItem("ze_config");return r?JSON.parse(r):null;}catch(e){return null;}}
function saveConfig(c){try{localStorage.setItem("ze_config",JSON.stringify(c));}catch(e){}}

const YEAR = new Date().getFullYear();
const HOLIDAYS = [...getSwissHolidays(YEAR),...getSwissHolidays(YEAR+1)];

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [configInput, setConfigInput] = useState({url:"",key:""});
  const [configErr, setConfigErr] = useState("");
  const [configTesting, setConfigTesting] = useState(false);
  const db = config ? createClient(config.url, config.key) : null;
  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncErr, setSyncErr] = useState("");
  const [session, setSession] = useState(null);
  const [loginStep, setLoginStep] = useState("pick");
  const [loginName, setLoginName] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginPin2, setLoginPin2] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loginSearch, setLoginSearch] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [adminErr, setAdminErr] = useState(false);
  const [view, setView] = useState("dashboard");
  const [selDate, setSelDate] = useState(today());
  const [modal, setModal] = useState(null);
  const [mEmployee, setMEmployee] = useState("");
  const [mType, setMType] = useState("work");
  const [mHours, setMHours] = useState("");
  const [mDate, setMDate] = useState(today());
  const [mDateTo, setMDateTo] = useState(today());
  const [mLocation, setMLocation] = useState("");
  const [mNote, setMNote] = useState("");
  const [mHoliday, setMHoliday] = useState("");
  const [mError, setMError] = useState("");
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const firstRef = useRef();
  const [adminTab, setAdminTab] = useState("employees");
  const [newEmpName, setNewEmpName] = useState("");
  const [nameError, setNameError] = useState("");
  const [editingEmp, setEditingEmp] = useState(null);
  const [editEmpVal, setEditEmpVal] = useState("");
  const [expandedEmp, setExpandedEmp] = useState(null);
  const fileRef = useRef();

  const loadData = useCallback(async () => {
    if (!db) return;
    setLoading(true); setSyncErr("");
    try {
      const [emps, ents] = await Promise.all([
        db.query("employees", {select:"*", order:"name.asc"}),
        db.query("time_entries", {select:"*", order:"date.desc,created_at.desc"})
      ]);
      setEmployees(emps.map(e=>({name:e.name, pinHash:e.pin_hash, id:e.id})));
      setEntries(ents.map(e=>({id:e.id,employee:e.employee,date:e.date,type:e.type,hours:e.hours_ms,location:e.location,note:e.note,holidayName:e.holiday_name,editedBy:e.edited_by})));
    } catch(e) { setSyncErr("Verbindungsfehler: "+e.message); }
    setLoading(false);
  }, [config]);

  useEffect(()=>{ if(config) loadData(); },[config]);
  useEffect(()=>{ if(modal) setTimeout(()=>firstRef.current?.focus(),80); },[modal]);

  async function testAndSaveConfig() {
    const url = configInput.url.trim().replace(/\/$/, "");
    const key = configInput.key.trim();
    if (!url || !key) { setConfigErr("Bitte beide Felder ausfüllen."); return; }
    setConfigTesting(true); setConfigErr("");
    try {
      const res = await fetch(`${url}/rest/v1/employees?select=name&limit=1`, {
        headers:{"apikey":key,"Authorization":`Bearer ${key}`}
      });
      if (!res.ok) throw new Error("Ungültige URL oder Key");
      saveConfig({url, key}); setConfig({url, key});
    } catch(e) { setConfigErr("Verbindung fehlgeschlagen: "+e.message); }
    setConfigTesting(false);
  }

  function holidayOnDate(date){ return HOLIDAYS.find(h=>h.date===date); }
  function pickEmployee(name){ const emp=employees.find(e=>e.name===name); setLoginName(name); setLoginPin(""); setLoginPin2(""); setLoginErr(""); setLoginStep(emp?.pinHash?"pin":"setpin"); }
  async function tryLogin(){ if(loginPin.length<4){setLoginErr("Mindestens 4 Ziffern.");return;} const emp=employees.find(e=>e.name===loginName); if(hashPin(loginPin)===emp?.pinHash){setSession({name:loginName,isAdmin:false});resetLogin();}else{setLoginErr("Falscher PIN.");setLoginPin("");} }
  function trySetPin(){if(loginPin.length<4){setLoginErr("Mindestens 4 Ziffern.");return;}setLoginStep("confirm");setLoginErr("");setLoginPin2("");}
  async function tryConfirmPin(){ if(loginPin2!==loginPin){setLoginErr("PINs stimmen nicht überein.");setLoginPin2("");return;} try{await db.upsert("employees",{name:loginName,pin_hash:hashPin(loginPin)},"name");setEmployees(p=>p.map(e=>e.name===loginName?{...e,pinHash:hashPin(loginPin)}:e));setSession({name:loginName,isAdmin:false});resetLogin();}catch(e){setLoginErr("Fehler beim Speichern.");} }
  function tryAdminLogin(){if(adminPin===ADMIN_PIN){setSession({name:"__admin__",isAdmin:true});setAdminErr(false);setAdminPin("");}else{setAdminErr(true);setAdminPin("");}}
  function resetLogin(){setLoginStep("pick");setLoginName("");setLoginPin("");setLoginPin2("");setLoginErr("");setLoginSearch("");}
  function logout(){setSession(null);resetLogin();setView("dashboard");setExpandedEmp(null);}
  async function resetMyPin(){ if(!window.confirm("PIN zurücksetzen?"))return; await db.update("employees","name=eq."+loginName,{pin_hash:null}); setEmployees(p=>p.map(e=>e.name===session.name?{...e,pinHash:null}:e)); logout(); }

  function openAdd(forEmployee,date=selDate){ setEditId(null);setMEmployee(forEmployee);setMType("work");setMHours("");setMDate(date);setMDateTo(date);setMLocation("");setMNote("");setMHoliday("");setMError(""); const h=holidayOnDate(date); if(h){setMType("holiday");setMHoliday(h.name);setMHours("8");} setModal("add"); }
  function openEdit(entry){ setEditId(entry.id);setMEmployee(entry.employee);setMType(entry.type);setMHours(msToH(entry.hours));setMDate(entry.date);setMDateTo(entry.date);setMLocation(entry.location||"");setMNote(entry.note||"");setMHoliday(entry.holidayName||"");setMError("");setModal("edit"); }
  function closeModal(){setModal(null);}

  async function saveEntry(){
    const h=parseFloat(mHours);
    if(!mHours||isNaN(h)||h<=0){setMError("Bitte gültige Stundenzahl eingeben.");return;}
    if(h>24){setMError("Mehr als 24h nicht möglich.");return;}
    setSaving(true);
    try {
      const isAdmin=session.isAdmin&&mEmployee!==session.name;
      if(mType==="vacation"&&!editId){
        const days=daysInRange(mDate,mDateTo);
        if(!days.length){setMError("Ungültiger Bereich.");setSaving(false);return;}
        const rows=days.map(d=>({employee:mEmployee,date:d,type:"vacation",hours_ms:hToMs(h),location:null,note:null,holiday_name:null,edited_by:isAdmin?"admin":null}));
        const inserted=await db.insert("time_entries",rows);
        setEntries(p=>[...inserted.map(e=>({id:e.id,employee:e.employee,date:e.date,type:e.type,hours:e.hours_ms,location:e.location,note:e.note,holidayName:e.holiday_name,editedBy:e.edited_by})),...p]);
      } else {
        const row={employee:mEmployee,date:mDate,type:mType,hours_ms:hToMs(h),location:NEEDS_LOC.has(mType)?(mLocation.trim()||null):null,note:NEEDS_NOTE.has(mType)?(mNote.trim()||null):null,holiday_name:mType==="holiday"?(mHoliday.trim()||null):null,edited_by:isAdmin?"admin":null};
        if(editId){ const updated=await db.update("time_entries","id=eq."+editId,row); const u=updated[0]; setEntries(p=>p.map(e=>e.id===editId?{id:u.id,employee:u.employee,date:u.date,type:u.type,hours:u.hours_ms,location:u.location,note:u.note,holidayName:u.holiday_name,editedBy:u.edited_by}:e)); }
        else { const inserted=await db.insert("time_entries",[row]); const n=inserted[0]; setEntries(p=>[{id:n.id,employee:n.employee,date:n.date,type:n.type,hours:n.hours_ms,location:n.location,note:n.note,holidayName:n.holiday_name,editedBy:n.edited_by},...p]); }
      }
      closeModal();
    } catch(e){ setMError("Fehler: "+e.message); }
    setSaving(false);
  }

  async function deleteEntry(id){ if(!window.confirm("Eintrag löschen?"))return; try{await db.remove("time_entries","id=eq."+id);setEntries(p=>p.filter(e=>e.id!==id));}catch(e){alert("Fehler: "+e.message);} }
  function empEntries(name,date=null){return entries.filter(e=>e.employee===name&&(!date||e.date===date));}
  function empTotals(name,date=null){const t={};TYPES.forEach(k=>{t[k]=0;});empEntries(name,date).forEach(e=>{t[e.type]=(t[e.type]||0)+e.hours;});return t;}
  function empVacDays(name){return entries.filter(e=>e.employee===name&&e.type==="vacation").length;}
  function shiftDate(d){const dt=new Date(selDate+"T12:00:00");dt.setDate(dt.getDate()+d);setSelDate(dt.toISOString().slice(0,10));}

  const empNames=employees.map(e=>e.name);
  const modalEmpLocs=[...new Set(entries.filter(e=>e.employee===mEmployee&&e.location).map(e=>e.location))].sort();
  const locSugg=mLocation.length===0?modalEmpLocs.slice(0,5):modalEmpLocs.filter(l=>l.toLowerCase().includes(mLocation.toLowerCase())&&l.toLowerCase()!==mLocation.toLowerCase()).slice(0,4);
  const filteredEmps=empNames.filter(n=>n.toLowerCase().includes(loginSearch.toLowerCase()));
  const todayHoliday=holidayOnDate(selDate);

  async function addEmployee(){ const n=newEmpName.trim();if(!n){setNameError("Name leer.");return;}if(empNames.includes(n)){setNameError("Existiert.");return;} try{await db.upsert("employees",{name:n},"name");setEmployees(p=>[...p,{name:n,pinHash:null}]);setNewEmpName("");setNameError("");}catch(e){setNameError("Fehler: "+e.message);} }
  async function removeEmployee(name){ if(!window.confirm(`${name} entfernen?`))return; try{await db.remove("time_entries","employee=eq."+encodeURIComponent(name));await db.remove("employees","name=eq."+encodeURIComponent(name));setEmployees(p=>p.filter(e=>e.name!==name));setEntries(p=>p.filter(e=>e.employee!==name));}catch(e){alert("Fehler: "+e.message);} }
  async function renameEmployee(){ const n=editEmpVal.trim();if(!n||n===editingEmp){setEditingEmp(null);return;}if(empNames.includes(n)){setNameError("Existiert.");return;} try{await db.upsert("employees",{name:n,pin_hash:employees.find(e=>e.name===editingEmp)?.pinHash||null},"name");await db.remove("employees","name=eq."+encodeURIComponent(editingEmp));const toUpdate=entries.filter(e=>e.employee===editingEmp);for(const e of toUpdate)await db.update("time_entries","id=eq."+e.id,{employee:n});setEmployees(p=>p.map(e=>e.name===editingEmp?{...e,name:n}:e));setEntries(p=>p.map(e=>e.employee===editingEmp?{...e,employee:n}:e));setEditingEmp(null);setNameError("");}catch(e){setNameError("Fehler: "+e.message);} }
  async function resetEmpPin(name){ if(!window.confirm(`PIN von ${name} zurücksetzen?`))return; try{await db.update("employees","name=eq."+encodeURIComponent(name),{pin_hash:null});setEmployees(p=>p.map(e=>e.name===name?{...e,pinHash:null}:e));}catch(e){alert("Fehler: "+e.message);} }
  function importCSV(e){ const f=e.target.files[0];if(!f)return; const r=new FileReader();r.onload=async ev=>{const nn=ev.target.result.split(/\r?\n/).map(l=>l.split(",")[0].trim()).filter(n=>n&&!empNames.includes(n));if(!nn.length){alert("Keine neuen Namen.");return;}for(const n of nn)await db.upsert("employees",{name:n},"name");setEmployees(p=>[...p,...nn.map(n=>({name:n,pinHash:null}))]);alert(`${nn.length} importiert.`);};r.readAsText(f);e.target.value=""; }
  function exportCSV(filter){ const rows=["Mitarbeiter,Datum,Typ,Stunden,Arbeitsstelle,Notiz,Feiertag,Geändert von"];const es=filter?entries.filter(e=>e.date===today()):entries;[...es].sort((a,b)=>b.date.localeCompare(a.date)).forEach(e=>{rows.push([e.employee,e.date,TYPE_LABELS[e.type],(e.hours/3600000).toFixed(2),e.location||"–",e.note||"–",e.holidayName||"–",e.editedBy||"–"].join(","));});const blob=new Blob([rows.join("\n")],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`zeiterfassung_${new Date().toISOString().slice(0,10)}.csv`;a.click(); }
  async function resetAll(){ if(!window.confirm("Alle Einträge löschen?"))return; try{await db.remove("time_entries","id=neq.00000000-0000-0000-0000-000000000000");setEntries([]);}catch(e){alert("Fehler: "+e.message);} }

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;700;800&display=swap');
    :root{--bg:#f4f5f7;--surface:#fff;--border:#e2e4ea;--hover:#eef0f5;--row:#fafbfc;--row-border:#eef0f5;--weekend:#f0f1f5;--muted-border:#d0d3de;--admin-bg:#fffbeb;--text:#1a1d2e;--text-strong:#0d0f1a;--text-sec:#374151;--text-muted:#6b7280;--text-faint:#9ca3af;--text-ghost:#d1d5db;}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);font-family:'DM Mono','Courier New',monospace}
    ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px}
    .btn{cursor:pointer;border:none;font-family:inherit;transition:all .15s;background:none}.btn:hover{filter:brightness(1.1)}.btn:active{transform:scale(.97)}
    .tab{cursor:pointer;transition:all .2s}
    input,select{outline:none;font-family:inherit}
    .inp{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:8px 12px;font-size:13px;font-family:inherit;width:100%}.inp:focus{border-color:#818cf8}
    .sel{background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:7px;padding:8px 12px;font-size:13px;font-family:inherit;width:100%}.sel:focus{border-color:#f59e0b}
    .atab{cursor:pointer;padding:8px 16px;border-radius:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;transition:all .2s;border:1px solid transparent}
    .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
    .sug{cursor:pointer;padding:5px 10px;border-radius:7px;font-size:11px;transition:all .15s;border:1px solid transparent}.sug:hover{background:var(--border)}
    .entry-row{transition:background .15s}.entry-row:hover{background:var(--hover)!important}
    .type-btn{cursor:pointer;border:none;font-family:inherit;transition:all .15s;padding:8px 4px;border-radius:8px;font-size:10px;text-align:center}.type-btn:hover{filter:brightness(1.1)}
    .emp-pick{cursor:pointer;padding:11px 14px;border-radius:9px;border:1px solid var(--border);background:var(--surface);transition:all .15s;text-align:left;width:100%;font-family:inherit}.emp-pick:hover{background:var(--hover)}
    @keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fadein{animation:fadein .2s ease}
    @keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite;display:inline-block}
  `;

  function EntryRow({entry,canEdit=true}){
    const lc=TYPE_COLORS[entry.type];
    return(
      <div className="entry-row" style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"var(--row)",borderBottom:"1px solid var(--row-border)",fontSize:11}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:lc,flexShrink:0}}/>
        <span style={{color:lc,fontWeight:600,minWidth:40}}>{formatH(entry.hours)}</span>
        <span style={{color:lc+"80",textTransform:"uppercase",fontSize:9,letterSpacing:".06em",minWidth:72}}>{TYPE_LABELS[entry.type]}</span>
        {entry.holidayName&&<span style={{color:"#e879f9",background:"#e879f915",padding:"1px 7px",borderRadius:7,border:"1px solid #e879f928"}}>{entry.holidayName}</span>}
        {entry.location&&<span style={{color:locColor(entry.location),background:locColor(entry.location)+"15",padding:"1px 7px",borderRadius:7}}>{entry.location}</span>}
        {entry.note&&<span style={{color:"#a78bfa",background:"#a78bfa15",padding:"1px 7px",borderRadius:7}}>{entry.note}</span>}
        {entry.editedBy==="admin"&&<span style={{color:"#f59e0b50",fontSize:9}}>★ Admin</span>}
        {canEdit&&<div style={{marginLeft:"auto",display:"flex",gap:5}}>
          <button className="btn" onClick={()=>openEdit(entry)} style={{padding:"3px 8px",borderRadius:5,background:"var(--border)",color:"var(--text-muted)",fontSize:10}}>✎</button>
          <button className="btn" onClick={()=>deleteEntry(entry.id)} style={{padding:"3px 8px",borderRadius:5,background:"var(--border)",color:"#ef4444",fontSize:10}}>✕</button>
        </div>}
      </div>
    );
  }

  function EntryModal(){
    if(!modal)return null;
    const isVac=mType==="vacation",isHol=mType==="holiday";
    const upHols=HOLIDAYS.filter(h=>h.date>=today()).slice(0,8);
    return(
      <div className="modal-bg" onClick={closeModal}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:28,width:440,maxWidth:"100%",maxHeight:"92vh",overflowY:"auto"}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:17,color:"var(--text-strong)",marginBottom:4}}>{editId?"Bearbeiten":"Eintragen"}</div>
          <div style={{fontSize:11,color:"var(--text-faint)",marginBottom:16}}>{mEmployee}</div>
          {session?.isAdmin&&<div style={{marginBottom:16}}><div style={{fontSize:10,color:"#f59e0b",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Mitarbeiter</div><select className="sel" value={mEmployee} onChange={e=>setMEmployee(e.target.value)}>{empNames.map(n=><option key={n} value={n}>{n}</option>)}</select></div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:5}}>
            {["work","pause","travel","sick"].map(t=><button key={t} className="type-btn" onClick={()=>setMType(t)} style={{background:mType===t?TYPE_COLORS[t]+"28":"var(--bg)",color:mType===t?TYPE_COLORS[t]:"#888",border:`1px solid ${mType===t?TYPE_COLORS[t]+"60":"var(--border)"}`}}><div style={{fontSize:14,marginBottom:2}}>{TYPE_ICONS[t]}</div><div style={{fontSize:10}}>{TYPE_LABELS[t]}</div></button>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:20}}>
            {["accident","other","vacation","holiday"].map(t=><button key={t} className="type-btn" onClick={()=>setMType(t)} style={{background:mType===t?TYPE_COLORS[t]+"28":"var(--bg)",color:mType===t?TYPE_COLORS[t]:"#888",border:`1px solid ${mType===t?TYPE_COLORS[t]+"60":"var(--border)"}`}}><div style={{fontSize:14,marginBottom:2}}>{TYPE_ICONS[t]}</div><div style={{fontSize:10}}>{TYPE_LABELS[t]}</div></button>)}
          </div>
          {isVac&&<div style={{marginBottom:16,background:"#06b6d415",border:"1px solid #06b6d430",borderRadius:9,padding:14}}>
            <div style={{fontSize:10,color:"#06b6d4",letterSpacing:".1em",textTransform:"uppercase",marginBottom:10}}>🏖 Ferienbereich</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
              <div><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Von</div><input ref={firstRef} className="inp" type="date" value={mDate} onChange={e=>setMDate(e.target.value)}/></div>
              <div><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Bis</div><input className="inp" type="date" value={mDateTo} min={mDate} onChange={e=>setMDateTo(e.target.value)}/></div>
            </div>
            {mDate&&mDateTo&&mDateTo>=mDate&&<div style={{fontSize:11,color:"#06b6d480",marginBottom:10}}>{daysInRange(mDate,mDateTo).length} Tage</div>}
            <div><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Stunden pro Tag</div>
            <input className="inp" type="text" inputMode="decimal" placeholder="z.B. 8" value={mHours} onChange={e=>setMHours(e.target.value.replace(/[^0-9.]/g,""))} style={{fontSize:15}}/></div>
          </div>}
          {isHol&&<div style={{marginBottom:16,background:"#e879f915",border:"1px solid #e879f930",borderRadius:9,padding:14}}>
            <div style={{fontSize:10,color:"#e879f9",letterSpacing:".1em",textTransform:"uppercase",marginBottom:10}}>🎉 Feiertag</div>
            <div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Datum</div>
            <input ref={firstRef} className="inp" type="date" value={mDate} onChange={e=>{setMDate(e.target.value);const h=holidayOnDate(e.target.value);if(h)setMHoliday(h.name);}} style={{marginBottom:10}}/>
            <div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:6}}>Name</div>
            <input className="inp" placeholder="Feiertagsname" value={mHoliday} onChange={e=>setMHoliday(e.target.value)} style={{marginBottom:10}}/>
            <div style={{fontSize:9,color:"var(--text-faint)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:6}}>Schweizer Feiertage</div>
            <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:140,overflowY:"auto"}}>
              {upHols.map(h=><button key={h.date} className="btn" onClick={()=>{setMDate(h.date);setMHoliday(h.name);}} style={{padding:"5px 10px",borderRadius:6,background:mDate===h.date?"#e879f920":"var(--bg)",color:mDate===h.date?"#e879f9":"#888",border:`1px solid ${mDate===h.date?"#e879f940":"var(--border)"}`,fontSize:11,textAlign:"left",display:"flex",justifyContent:"space-between"}}><span>{h.name}</span><span style={{color:"var(--text-faint)"}}>{fDate(h.date)}</span></button>)}
            </div>
          </div>}
          {!isVac&&!isHol&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            <div><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Datum</div><input ref={firstRef} className="inp" type="date" value={mDate} onChange={e=>setMDate(e.target.value)}/></div>
            <div><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Stunden</div><input className="inp" type="text" inputMode="decimal" placeholder="z.B. 8 oder 7.5" value={mHours} onChange={e=>setMHours(e.target.value.replace(/[^0-9.]/g,""))} onKeyDown={e=>e.key==="Enter"&&saveEntry()} style={{fontSize:16}}/></div>
          </div>}
          {isHol&&<div style={{marginTop:12,marginBottom:16}}><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Stunden</div><input className="inp" type="text" inputMode="decimal" placeholder="z.B. 8" value={mHours} onChange={e=>setMHours(e.target.value.replace(/[^0-9.]/g,""))} onKeyDown={e=>e.key==="Enter"&&saveEntry()} style={{fontSize:16}}/></div>}
          {NEEDS_LOC.has(mType)&&<div style={{marginBottom:16}}><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Arbeitsstelle</div><input className="inp" placeholder="z.B. Filiale West …" value={mLocation} onChange={e=>setMLocation(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEntry()}/>{locSugg.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:7}}>{locSugg.map(l=>{const lc=locColor(l);return<div key={l} className="sug" onClick={()=>setMLocation(l)} style={{color:lc,background:lc+"15",borderColor:lc+"30"}}>{l}</div>;})}</div>}</div>}
          {NEEDS_NOTE.has(mType)&&<div style={{marginBottom:16}}><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Was ist es?</div><input className="inp" placeholder="z.B. Arzttermin …" value={mNote} onChange={e=>setMNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveEntry()}/></div>}
          {mError&&<div style={{color:"#ef4444",fontSize:11,marginBottom:12}}>{mError}</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button className="btn" onClick={closeModal} style={{padding:10,borderRadius:8,background:"var(--border)",color:"var(--text-muted)",fontSize:12}}>Abbrechen</button>
            <button className="btn" onClick={saveEntry} disabled={saving} style={{padding:10,borderRadius:8,background:TYPE_COLORS[mType],color:"#000",fontWeight:700,fontSize:13,opacity:saving?0.6:1}}>
              {saving?"Speichert…":isVac&&mDate&&mDateTo&&mDateTo>=mDate?`${daysInRange(mDate,mDateTo).length} Tage`:mHours?`${mHours}h`:"Speichern"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function CalendarView({employee}){
    const [cy,setCy]=useState(new Date().getFullYear());
    const [cm,setCm]=useState(new Date().getMonth());
    function sm(d){let m=cm+d,y=cy;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setCm(m);setCy(y);}
    const startOff=(new Date(cy,cm,1).getDay()+6)%7;
    const dim=new Date(cy,cm+1,0).getDate();
    const cells=[...Array(startOff).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
    const mn=new Date(cy,cm,1).toLocaleDateString("de-DE",{month:"long",year:"numeric"});
    return(
      <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,padding:16,maxWidth:520}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <button className="btn" onClick={()=>sm(-1)} style={{padding:"5px 12px",borderRadius:6,background:"var(--border)",color:"var(--text-muted)"}}>←</button>
          <span style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,color:"var(--text-strong)"}}>{mn}</span>
          <button className="btn" onClick={()=>sm(1)} style={{padding:"5px 12px",borderRadius:6,background:"var(--border)",color:"var(--text-muted)"}}>→</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {["Mo","Di","Mi","Do","Fr","Sa","So"].map(d=><div key={d} style={{textAlign:"center",fontSize:9,color:"var(--text-faint)",padding:"4px 0"}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {cells.map((d,i)=>{
            if(!d)return<div key={i}/>;
            const ds=`${cy}-${String(cm+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const des=entries.filter(e=>e.employee===employee&&e.date===ds);
            const hol=holidayOnDate(ds),isT=ds===today(),isW=(i%7)>=5;
            return<div key={i} onClick={()=>{setSelDate(ds);setView("dashboard");}} className="btn" style={{padding:"5px 3px",borderRadius:6,textAlign:"center",minHeight:36,background:hol?"#e879f910":isT?"#22c55e12":isW?"var(--weekend)":"transparent",border:`1px solid ${isT?"#22c55e40":hol?"#e879f930":"transparent"}`,transition:"all .15s"}}>
              <div style={{fontSize:11,color:isT?"#22c55e":isW?"#aaa":"#888",fontWeight:isT?700:400}}>{d}</div>
              {hol&&<div style={{fontSize:6,color:"#e879f9"}}>🎉</div>}
              {des.length>0&&<div style={{display:"flex",justifyContent:"center",gap:2,marginTop:2}}>{[...new Set(des.map(e=>e.type))].slice(0,3).map(t=><div key={t} style={{width:5,height:5,borderRadius:"50%",background:TYPE_COLORS[t]}}/>)}</div>}
            </div>;
          })}
        </div>
      </div>
    );
  }

  if(!config) return(
    <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'DM Mono','Courier New',monospace",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{css}</style>
      <div style={{width:"100%",maxWidth:480}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:24,color:"var(--text-strong)",letterSpacing:".08em"}}>ZEITERFASSUNG</div>
          <div style={{fontSize:12,color:"var(--text-faint)",marginTop:6}}>Supabase-Verbindung einrichten</div>
        </div>
        <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:28}}>
          <div style={{fontSize:11,color:"#818cf8",letterSpacing:".08em",textTransform:"uppercase",marginBottom:20}}>Supabase API-Zugangsdaten</div>
          <div style={{marginBottom:14}}><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Project URL</div><input className="inp" placeholder="https://xxxxx.supabase.co" value={configInput.url} onChange={e=>setConfigInput(p=>({...p,url:e.target.value}))} style={{fontFamily:"monospace",fontSize:12}}/></div>
          <div style={{marginBottom:20}}><div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Anon Public Key</div><input className="inp" placeholder="eyJhbGciOi…" value={configInput.key} onChange={e=>setConfigInput(p=>({...p,key:e.target.value}))} style={{fontFamily:"monospace",fontSize:11}}/></div>
          {configErr&&<div style={{color:"#ef4444",fontSize:11,marginBottom:12,background:"#ef444415",padding:"8px 12px",borderRadius:7}}>{configErr}</div>}
          <button className="btn" onClick={testAndSaveConfig} disabled={configTesting} style={{width:"100%",padding:11,borderRadius:8,background:"#818cf8",color:"#000",fontWeight:700,fontSize:14,opacity:configTesting?0.6:1}}>
            {configTesting?"Wird getestet…":"Verbindung testen & speichern"}
          </button>
          <div style={{marginTop:20,padding:16,background:"var(--bg)",borderRadius:9,border:"1px solid var(--border)"}}>
            <div style={{fontSize:11,color:"var(--text-faint)",lineHeight:1.8}}>
              1. supabase.com → Dein Projekt<br/>
              2. Settings → API Keys<br/>
              3. Project URL + Publishable Key kopieren
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:"var(--bg)",color:"var(--text)",fontFamily:"'DM Mono','Courier New',monospace"}}>
      <style>{css}</style>
      {session&&<EntryModal/>}
      {loading&&<div style={{position:"fixed",inset:0,background:"rgba(244,245,247,0.8)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{color:"#22c55e",fontSize:13,display:"flex",alignItems:"center",gap:10}}><span className="spin">⟳</span> Laden…</div></div>}
      {syncErr&&<div style={{background:"#ef444420",borderBottom:"1px solid #ef444440",padding:"8px 24px",fontSize:11,color:"#ef4444",display:"flex",alignItems:"center",justifyContent:"space-between"}}>{syncErr}<button className="btn" onClick={loadData} style={{color:"#ef4444",fontSize:11}}>Erneut versuchen</button></div>}

      {!session&&(
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
          <div className="fadein" style={{width:"100%",maxWidth:400}}>
            <div style={{textAlign:"center",marginBottom:32}}>
              <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:24,color:"var(--text-strong)",letterSpacing:".08em"}}>ZEITERFASSUNG</div>
              <div style={{fontSize:10,color:"var(--text-ghost)",marginTop:4,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#22c55e"}}/>Verbunden
                <button className="btn" onClick={()=>{saveConfig(null);setConfig(null);}} style={{color:"var(--text-ghost)",fontSize:10,marginLeft:4}}>ändern</button>
              </div>
            </div>
            {loginStep==="pick"&&(
              <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:22}}>
                <input className="inp" placeholder="Name suchen …" value={loginSearch} onChange={e=>setLoginSearch(e.target.value)} style={{marginBottom:12}}/>
                <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:300,overflowY:"auto",marginBottom:16}}>
                  {filteredEmps.map(name=>{const emp=employees.find(e=>e.name===name);return(
                    <button key={name} className="emp-pick" onClick={()=>pickEmployee(name)}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{fontSize:14,color:"var(--text-sec)"}}>{name}</span>
                        <span style={{fontSize:9,color:emp?.pinHash?"#22c55e":"#ccc"}}>{emp?.pinHash?"●":"NEU"}</span>
                      </div>
                    </button>
                  );})}
                  {!filteredEmps.length&&<div style={{fontSize:12,color:"var(--text-ghost)",textAlign:"center",padding:"12px 0"}}>Kein Treffer</div>}
                </div>
                <div style={{borderTop:"1px solid var(--border)",paddingTop:14}}>
                  <div style={{fontSize:10,color:"var(--text-faint)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Admin</div>
                  <div style={{display:"flex",gap:8}}>
                    <input className="inp" type="password" placeholder="Admin-PIN" value={adminPin} onChange={e=>setAdminPin(e.target.value)} onKeyDown={e=>e.key==="Enter"&&tryAdminLogin()} style={{letterSpacing:"0.4em",fontSize:16}}/>
                    <button className="btn" onClick={tryAdminLogin} style={{padding:"8px 16px",borderRadius:7,background:"#f59e0b",color:"#000",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>Login</button>
                  </div>
                  {adminErr&&<div style={{color:"#ef4444",fontSize:11,marginTop:6}}>Falscher PIN</div>}
                </div>
              </div>
            )}
            {(loginStep==="pin"||loginStep==="setpin"||loginStep==="confirm")&&(
              <div className="fadein" style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:28,textAlign:"center"}}>
                {loginStep==="setpin"&&<div style={{fontSize:11,color:"#818cf8",marginBottom:4}}>Erster Login – PIN wählen</div>}
                {loginStep==="confirm"&&<div style={{fontSize:11,color:"#818cf8",marginBottom:4}}>PIN bestätigen</div>}
                <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:20,color:"var(--text-strong)",marginBottom:16}}>{loginName}</div>
                <input className="inp" type="password" placeholder={loginStep==="confirm"?"PIN wiederholen":"Dein PIN"}
                  value={loginStep==="confirm"?loginPin2:loginPin}
                  onChange={e=>loginStep==="confirm"?setLoginPin2(e.target.value):setLoginPin(e.target.value)} autoFocus
                  onKeyDown={e=>e.key==="Enter"&&(loginStep==="pin"?tryLogin():loginStep==="setpin"?trySetPin():tryConfirmPin())}
                  style={{textAlign:"center",fontSize:22,letterSpacing:"0.5em",marginBottom:10}}/>
                {loginErr&&<div style={{color:"#ef4444",fontSize:11,marginBottom:10}}>{loginErr}</div>}
                <button className="btn" onClick={loginStep==="pin"?tryLogin:loginStep==="setpin"?trySetPin:tryConfirmPin}
                  style={{width:"100%",padding:11,borderRadius:8,background:"#22c55e",color:"#000",fontWeight:700,fontSize:14,marginBottom:10}}>
                  {loginStep==="pin"?"Anmelden":loginStep==="setpin"?"Weiter →":"PIN speichern & anmelden"}
                </button>
                <button className="btn" onClick={()=>{setLoginStep("pick");setLoginErr("");}} style={{color:"var(--text-faint)",fontSize:11}}>← Zurück</button>
              </div>
            )}
          </div>
        </div>
      )}

      {session&&(<>
        <div style={{background:"var(--surface)",borderBottom:"1px solid var(--border)",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:9,height:9,borderRadius:"50%",background:"#22c55e",boxShadow:"0 0 6px #22c55e"}}/>
            <span style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:17,letterSpacing:".05em",color:"var(--text-strong)"}}>ZEITERFASSUNG</span>
          </div>
          <div style={{display:"flex",gap:4}}>
            {(session.isAdmin?[["dashboard","Übersicht"],["history","Verlauf"],["calendar","Kalender"],["admin","⚙ Admin"]]:[["dashboard","Dashboard"],["history","Verlauf"],["calendar","Kalender"]]).map(([v,l])=>(
              <div key={v} className="tab" onClick={()=>setView(v)} style={{padding:"6px 12px",borderRadius:6,fontSize:11,fontWeight:500,letterSpacing:".08em",textTransform:"uppercase",color:view===v?"var(--text-strong)":v==="admin"?"#f59e0b88":"var(--text-faint)",background:view===v?(v==="admin"?"var(--admin-bg)":"var(--border)"):"transparent"}}>{l}</div>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button className="btn" onClick={loadData} style={{color:"var(--text-ghost)",fontSize:14}}>⟳</button>
            <span style={{fontSize:11,color:"var(--text-faint)"}}>{session.isAdmin?"Admin":session.name}</span>
            {!session.isAdmin&&<button className="btn" onClick={resetMyPin} style={{padding:"4px 9px",borderRadius:5,background:"var(--border)",color:"var(--text-faint)",fontSize:10}}>PIN</button>}
            <button className="btn" onClick={logout} style={{padding:"5px 12px",borderRadius:6,background:"var(--border)",color:"var(--text-muted)",fontSize:11}}>Abmelden</button>
          </div>
        </div>

        {view==="dashboard"&&<div style={{padding:"14px 24px 0",display:"flex",alignItems:"center",gap:10}}>
          <button className="btn" onClick={()=>shiftDate(-1)} style={{padding:"7px 13px",borderRadius:7,background:"var(--border)",color:"var(--text-muted)",fontSize:14}}>←</button>
          <input type="date" value={selDate} onChange={e=>setSelDate(e.target.value)} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-strong)",borderRadius:7,padding:"7px 12px",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
          <button className="btn" onClick={()=>shiftDate(1)} style={{padding:"7px 13px",borderRadius:7,background:"var(--border)",color:"var(--text-muted)",fontSize:14}}>→</button>
          <button className="btn" onClick={()=>setSelDate(today())} style={{padding:"6px 12px",borderRadius:6,background:"var(--border)",color:"var(--text-faint)",fontSize:11}}>Heute</button>
          {todayHoliday&&<span style={{fontSize:11,color:"#e879f9",background:"#e879f915",padding:"4px 10px",borderRadius:8,border:"1px solid #e879f930"}}>🎉 {todayHoliday.name}</span>}
          <span style={{marginLeft:"auto",fontSize:12,color:"var(--text-faint)"}}>{fDate(selDate)}</span>
        </div>}

        {!session.isAdmin&&view==="dashboard"&&<div style={{padding:24}}>
          {(()=>{const t=empTotals(session.name,selDate);return<div style={{display:"flex",gap:10,marginBottom:22,flexWrap:"wrap",alignItems:"center"}}>
            {TYPES.filter(k=>t[k]>0).map(k=><div key={k} style={{background:"var(--surface)",border:`1px solid ${TYPE_COLORS[k]}28`,borderRadius:9,padding:"9px 14px"}}><div style={{fontSize:18,fontWeight:600,color:TYPE_COLORS[k]}}>{formatH(t[k])}</div><div style={{fontSize:9,color:TYPE_COLORS[k]+"70",textTransform:"uppercase",letterSpacing:".08em",marginTop:2}}>{TYPE_LABELS[k]}</div></div>)}
            <button className="btn" onClick={()=>openAdd(session.name,selDate)} style={{padding:"10px 20px",borderRadius:9,background:"#22c55e18",color:"#22c55e",fontSize:13,border:"1px solid #22c55e30",marginLeft:"auto"}}>+ Eintragen</button>
          </div>;})()}
          {(()=>{const es=empEntries(session.name,selDate);return es.length===0?<div style={{textAlign:"center",color:"var(--text-ghost)",padding:"40px 0",fontSize:13}}>Noch kein Eintrag. <span style={{color:"#22c55e",cursor:"pointer"}} onClick={()=>openAdd(session.name,selDate)}>+ Hinzufügen</span></div>:<div style={{display:"flex",flexDirection:"column",gap:1,borderRadius:10,overflow:"hidden",border:"1px solid var(--row-border)"}}>{es.map(e=><EntryRow key={e.id} entry={e}/>)}</div>;})()}
        </div>}

        {!session.isAdmin&&view==="history"&&<div style={{padding:24}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"var(--text-strong)",marginBottom:4,letterSpacing:".05em"}}>MEIN VERLAUF</div>
          {(()=>{const vd=empVacDays(session.name);return vd>0&&<div style={{fontSize:12,color:"#06b6d4",marginBottom:14}}>🏖 {vd} Ferientag{vd!==1?"e":""} eingetragen</div>;})()}
          {(()=>{const all=empEntries(session.name);if(!all.length)return<div style={{textAlign:"center",color:"var(--text-ghost)",padding:"40px 0"}}>Noch keine Einträge</div>;
            const byDate={};all.forEach(e=>{if(!byDate[e.date])byDate[e.date]=[];byDate[e.date].push(e);});
            return Object.keys(byDate).sort().reverse().map(date=>{const h=holidayOnDate(date);return<div key={date} style={{marginBottom:7}}>
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:"var(--surface)",borderRadius:"8px 8px 0 0",borderBottom:"1px solid var(--bg)"}}>
                <span style={{fontSize:11,color:"var(--text-faint)"}}>{fDate(date)}</span>
                {h&&<span style={{fontSize:10,color:"#e879f9"}}>🎉 {h.name}</span>}
                <button className="btn" onClick={()=>{setSelDate(date);setView("dashboard");}} style={{marginLeft:"auto",padding:"2px 8px",borderRadius:5,background:"var(--border)",color:"var(--text-faint)",fontSize:10}}>→</button>
              </div>
              <div style={{borderRadius:"0 0 8px 8px",overflow:"hidden"}}>{byDate[date].map(e=><EntryRow key={e.id} entry={e}/>)}</div>
            </div>;});
          })()}
        </div>}

        {!session.isAdmin&&view==="calendar"&&<div style={{padding:24}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"var(--text-strong)",marginBottom:20,letterSpacing:".05em"}}>MEIN KALENDER</div>
          <CalendarView employee={session.name}/>
        </div>}

        {session.isAdmin&&view==="dashboard"&&<div style={{padding:24}}>
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
            <button className="btn" onClick={()=>{setMEmployee(empNames[0]||"");openAdd(empNames[0]||"",selDate);}} style={{padding:"8px 16px",borderRadius:8,background:"#f59e0b18",color:"#f59e0b",fontSize:12,border:"1px solid #f59e0b30"}}>+ Eintrag für Mitarbeiter</button>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {empNames.map(name=>{const es=empEntries(name,selDate),t=empTotals(name,selDate),exp=expandedEmp===name;return(
              <div key={name} style={{background:"var(--surface)",borderRadius:11,border:`1px solid ${es.length?"#22c55e20":"var(--border)"}`,borderLeft:`3px solid ${es.length?"#22c55e":"var(--muted-border)"}`,overflow:"hidden"}}>
                <div style={{padding:"12px 16px",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,color:"var(--text-strong)",marginBottom:es.length?4:0}}>{name.split(" ")[0]} <span style={{color:"var(--text-faint)"}}>{name.split(" ").slice(1).join(" ")}</span></div>
                    {es.length>0&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{TYPES.filter(k=>t[k]>0).map(k=><span key={k} style={{fontSize:11,color:TYPE_COLORS[k]}}>{TYPE_ICONS[k]} {formatH(t[k])}</span>)}</div>}
                    {!es.length&&<span style={{fontSize:10,color:"var(--text-ghost)"}}>Kein Eintrag</span>}
                  </div>
                  <button className="btn" onClick={()=>openAdd(name,selDate)} style={{padding:"6px 12px",borderRadius:7,background:"#f59e0b18",color:"#f59e0b",fontSize:11,border:"1px solid #f59e0b28",whiteSpace:"nowrap"}}>+ Eintragen</button>
                  {es.length>0&&<button className="btn" onClick={()=>setExpandedEmp(exp?null:name)} style={{padding:"6px 10px",borderRadius:7,background:"var(--border)",color:"var(--text-faint)",fontSize:11}}>{exp?"▲":"▼"}</button>}
                </div>
                {exp&&<div style={{borderTop:"1px solid var(--border)"}}>{es.map(e=><EntryRow key={e.id} entry={e}/>)}</div>}
              </div>
            );})}
          </div>
        </div>}

        {session.isAdmin&&view==="history"&&<div style={{padding:24}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"var(--text-strong)",marginBottom:20,letterSpacing:".05em"}}>VERLAUF ALLE</div>
          {empNames.map(name=>{const all=empEntries(name);if(!all.length)return null;
            const t=empTotals(name),vd=empVacDays(name);
            const byDate={};all.forEach(e=>{if(!byDate[e.date])byDate[e.date]=[];byDate[e.date].push(e);});
            return<div key={name} style={{marginBottom:28}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <div><div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:15,color:"var(--text-strong)"}}>{name}</div>{vd>0&&<div style={{fontSize:10,color:"#06b6d4",marginTop:2}}>🏖 {vd} Ferientage</div>}</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{TYPES.filter(k=>t[k]>0).map(k=><span key={k} style={{fontSize:11,color:TYPE_COLORS[k]}}>{formatH(t[k])} <span style={{fontSize:9,color:TYPE_COLORS[k]+"60"}}>{TYPE_LABELS[k]}</span></span>)}</div>
              </div>
              {Object.keys(byDate).sort().reverse().map(date=>{const h=holidayOnDate(date);return<div key={date} style={{marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",background:"var(--surface)",borderRadius:"7px 7px 0 0",borderBottom:"1px solid var(--bg)"}}>
                  <span style={{fontSize:11,color:"var(--text-faint)"}}>{fDate(date)}</span>
                  {h&&<span style={{fontSize:10,color:"#e879f9"}}>🎉 {h.name}</span>}
                  <button className="btn" onClick={()=>openAdd(name,date)} style={{marginLeft:"auto",padding:"2px 9px",borderRadius:5,background:"#f59e0b18",color:"#f59e0b",fontSize:10,border:"1px solid #f59e0b28"}}>+ Tag</button>
                </div>
                <div style={{borderRadius:"0 0 7px 7px",overflow:"hidden"}}>{byDate[date].map(e=><EntryRow key={e.id} entry={e}/>)}</div>
              </div>;})}
            </div>;
          })}
          {!entries.length&&<div style={{textAlign:"center",color:"var(--text-ghost)",padding:"48px 0"}}>Noch keine Einträge</div>}
        </div>}

        {session.isAdmin&&view==="calendar"&&<div style={{padding:24}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:18,color:"var(--text-strong)",marginBottom:20,letterSpacing:".05em"}}>KALENDER</div>
          <div style={{display:"flex",flexDirection:"column",gap:24}}>
            {empNames.map(name=><div key={name}><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,color:"var(--text-strong)",marginBottom:10}}>{name}</div><CalendarView employee={name}/></div>)}
          </div>
        </div>}

        {session.isAdmin&&view==="admin"&&<div style={{padding:24}}>
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:800,fontSize:20,color:"#f59e0b",letterSpacing:".05em",marginBottom:20}}>⚙ ADMIN</div>
          <div style={{display:"flex",gap:6,marginBottom:24}}>
            {[["employees","Mitarbeiter"],["export","Export"],["settings","Einstellungen"]].map(([k,l])=>(
              <div key={k} className="atab" onClick={()=>setAdminTab(k)} style={{color:adminTab===k?"#f59e0b":"var(--text-faint)",background:adminTab===k?"var(--admin-bg)":"transparent",borderColor:adminTab===k?"#f59e0b40":"var(--border)"}}>{l}</div>
            ))}
          </div>
          {adminTab==="employees"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
            <div>
              <div style={{fontSize:11,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:12}}>Hinzufügen</div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input className="inp" placeholder="Vor- und Nachname" value={newEmpName} onChange={e=>setNewEmpName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addEmployee()}/>
                <button className="btn" onClick={addEmployee} style={{padding:"8px 16px",borderRadius:7,background:"#22c55e",color:"#000",fontWeight:700,fontSize:13,whiteSpace:"nowrap"}}>+ Add</button>
              </div>
              {nameError&&<div style={{color:"#ef4444",fontSize:11,marginBottom:8}}>{nameError}</div>}
              <div style={{marginTop:20,fontSize:11,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:10}}>CSV importieren</div>
              <input type="file" accept=".csv,.txt" ref={fileRef} onChange={importCSV} style={{display:"none"}}/>
              <button className="btn" onClick={()=>fileRef.current.click()} style={{padding:"9px 18px",borderRadius:7,background:"var(--border)",color:"#3b82f6",fontSize:12,border:"1px solid #3b82f640"}}>📁 CSV wählen</button>
            </div>
            <div>
              <div style={{fontSize:11,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:12}}>Liste ({empNames.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:460,overflowY:"auto"}}>
                {employees.map(emp=><div key={emp.name} style={{background:"var(--surface)",borderRadius:8,padding:"10px 12px",border:"1px solid var(--border)"}}>
                  {editingEmp===emp.name?<div style={{display:"flex",gap:8}}>
                    <input className="inp" value={editEmpVal} onChange={e=>setEditEmpVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&renameEmployee()} style={{flex:1,padding:"4px 8px",fontSize:12}} autoFocus/>
                    <button className="btn" onClick={renameEmployee} style={{padding:"4px 10px",borderRadius:5,background:"#22c55e",color:"#000",fontSize:11}}>✓</button>
                    <button className="btn" onClick={()=>setEditingEmp(null)} style={{padding:"4px 10px",borderRadius:5,background:"var(--border)",color:"var(--text-muted)",fontSize:11}}>✕</button>
                  </div>:<div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:"var(--text-sec)"}}>{emp.name}</div>
                      <div style={{display:"flex",gap:8,marginTop:2}}>
                        <span style={{fontSize:9,color:emp.pinHash?"#22c55e":"#ccc"}}>{emp.pinHash?"PIN gesetzt":"Kein PIN"}</span>
                        {empVacDays(emp.name)>0&&<span style={{fontSize:9,color:"#06b6d4"}}>🏖 {empVacDays(emp.name)}T</span>}
                      </div>
                    </div>
                    {emp.pinHash&&<button className="btn" onClick={()=>resetEmpPin(emp.name)} style={{padding:"3px 8px",borderRadius:5,background:"var(--border)",color:"#f59e0b",fontSize:9,whiteSpace:"nowrap"}}>PIN reset</button>}
                    <button className="btn" onClick={()=>{setEditingEmp(emp.name);setEditEmpVal(emp.name);setNameError("");}} style={{padding:"3px 8px",borderRadius:5,background:"var(--border)",color:"var(--text-muted)",fontSize:10}}>✎</button>
                    <button className="btn" onClick={()=>removeEmployee(emp.name)} style={{padding:"3px 8px",borderRadius:5,background:"var(--border)",color:"#ef4444",fontSize:10}}>✕</button>
                  </div>}
                </div>)}
              </div>
            </div>
          </div>}
          {adminTab==="export"&&<div style={{maxWidth:480}}>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
              {[{label:"Alle Einträge",sub:`${entries.length} gesamt`,color:"#22c55e",filter:false},{label:"Nur heute",sub:`${entries.filter(e=>e.date===today()).length} Einträge`,color:"#3b82f6",filter:true}].map(ex=>(
                <div key={ex.label} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div><div style={{color:"var(--text-sec)",fontWeight:500,marginBottom:4}}>{ex.label}</div><div style={{fontSize:11,color:"var(--text-faint)"}}>{ex.sub}</div></div>
                  <button className="btn" onClick={()=>exportCSV(ex.filter)} style={{padding:"9px 18px",borderRadius:7,background:ex.color,color:"#000",fontWeight:700,fontSize:12}}>↓ Export</button>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:"var(--text-faint)",letterSpacing:".1em",textTransform:"uppercase",marginBottom:12}}>Ferienübersicht</div>
            <div style={{display:"flex",flexDirection:"column",gap:5}}>
              {employees.map(emp=>{const vd=empVacDays(emp.name);return(
                <div key={emp.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--surface)",borderRadius:8,padding:"10px 14px",border:"1px solid var(--border)"}}>
                  <span style={{fontSize:13,color:"var(--text-sec)"}}>{emp.name}</span>
                  <span style={{fontSize:12,color:vd>0?"#06b6d4":"#ccc"}}>{vd>0?`🏖 ${vd} Tage`:"–"}</span>
                </div>
              );})}
            </div>
          </div>}
          {adminTab==="settings"&&<div style={{maxWidth:400}}>
            <div style={{background:"var(--surface)",border:"1px solid #ef444430",borderRadius:10,padding:20,marginBottom:12}}>
              <div style={{color:"var(--text-sec)",fontWeight:500,marginBottom:4}}>Alle Einträge löschen</div>
              <div style={{fontSize:11,color:"var(--text-faint)",marginBottom:16}}>Mitarbeiterliste und PINs bleiben erhalten.</div>
              <button className="btn" onClick={resetAll} style={{padding:"9px 18px",borderRadius:7,background:"#ef444420",color:"#ef4444",fontWeight:700,fontSize:12,border:"1px solid #ef444440"}}>⚠ Alle Einträge löschen</button>
            </div>
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:20,marginBottom:12}}>
              <div style={{color:"var(--text-sec)",fontWeight:500,marginBottom:6}}>Admin-PIN</div>
              <div style={{fontSize:11,color:"var(--text-faint)",lineHeight:1.7}}>Aktuell: <span style={{color:"#f59e0b"}}>4774</span></div>
            </div>
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:20}}>
              <div style={{color:"var(--text-sec)",fontWeight:500,marginBottom:6}}>Supabase-Verbindung</div>
              <div style={{fontSize:11,color:"var(--text-faint)",marginBottom:10}}>Projekt: <span style={{color:"#818cf8"}}>{config.url.replace("https://","").split(".")[0]}</span></div>
              <button className="btn" onClick={()=>{if(window.confirm("Verbindung trennen?")){{saveConfig(null);setConfig(null);logout();}}}} style={{padding:"7px 14px",borderRadius:6,background:"var(--border)",color:"var(--text-faint)",fontSize:11}}>Verbindung ändern</button>
            </div>
          </div>}
        </div>}
      </>)}
    </div>
  );
}