import { useState, useEffect, useRef, useCallback } from "react";
import { readGame, writeGame, updateGame, subscribeGame } from "./firebase";
import { DEFAULT_OPDRACHTEN } from "./defaultOpdrachten";

const randCode = () => Math.random().toString(36).substring(2, 7).toUpperCase();
const LS_KEY = "widm_session";
const saveSession = d => { try { localStorage.setItem(LS_KEY, JSON.stringify(d)); } catch {} };
const loadSession = () => { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; } };
const clearSession = () => { try { localStorage.removeItem(LS_KEY); } catch {} };
const euro = n => `€${Number(n).toLocaleString("nl-NL")}`;

const MOL_VRAGEN = [
  { vraag: "Wie is de Mol?", opties: [], correct: null },
  { vraag: "Wat is het haar van de Mol?", opties: ["Donker", "Blond", "Rood", "Grijs / Wit"], correct: null },
  { vraag: "Welk geslacht heeft de Mol?", opties: ["Man", "Vrouw", "Anders"], correct: null },
  { vraag: "Droeg de Mol vandaag iets rods?", opties: ["Ja", "Nee", "Weet ik niet"], correct: null },
  { vraag: "Hoe oud schat jij de Mol?", opties: ["Onder de 25", "25–35", "35–45", "Boven de 45"], correct: null },
  { vraag: "Saboteerde de Mol actief tijdens een opdracht?", opties: ["Ja, duidelijk", "Misschien", "Nee"], correct: null },
  { vraag: "Maakte de Mol een opvallende fout?", opties: ["Ja", "Nee"], correct: null },
  { vraag: "Hoe staat de Mol in de groep?", opties: ["Leider", "Volger", "Buitenstaander"], correct: null },
  { vraag: "Hoe zeker ben jij van je antwoord op vraag 1?", opties: ["Heel zeker", "Redelijk zeker", "Gok"], correct: null },
  { vraag: "Vertrouw jij de Mol in het dagelijks leven?", opties: ["Ja", "Nee", "Twijfel"], correct: null },
];

const C = {
  bg: "#0a0a0a", card: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.09)",
  borderGold: "rgba(212,175,55,.35)", borderGreen: "rgba(46,204,113,.35)",
  gold: "#d4af37", goldLight: "#f0d060", green: "#2ecc71", red: "#e74c3c",
  text: "#e8e0d0", muted: "#6a6055", faint: "#1e1a16",
};

export default function App() {
  const [screen, setScreen] = useState("home");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [game, setGame] = useState(null);
  const [myId] = useState(() => loadSession()?.myId || Math.random().toString(36).slice(2));
  const [isHost, setIsHost] = useState(false);
  const [err, setErr] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [tab, setTab] = useState("spelers");

  // create game options
  const [createOpen, setCreateOpen] = useState(true); // open = iedereen kan joinen
  const [manualName, setManualName] = useState("");

  // spelleider
  const [newOpdracht, setNewOpdracht] = useState({ titel: "", beschrijving: "", maxBedrag: "" });
  const [showDefaults, setShowDefaults] = useState(false);
  const [verdiendeInput, setVerdiendeInput] = useState({});
  const [potInput, setPotInput] = useState("");

  // test builder
  const [newVraagTekst, setNewVraagTekst] = useState("");
  const [newVraagOpties, setNewVraagOpties] = useState(["", ""]);
  const [newVraagCorrect, setNewVraagCorrect] = useState(null);
  const [showDefaultVragen, setShowDefaultVragen] = useState(false);

  // eliminatie
  const [elimTarget, setElimTarget] = useState(null);
  const [showElimConfirm, setShowElimConfirm] = useState(false);

  // speler
  const [testAntwoorden, setTestAntwoorden] = useState({});
  const [testIngediend, setTestIngediend] = useState(false);
  const [rolShown, setRolShown] = useState(false); // true after game starts, hides after dismiss

  // rol reveal state from Firebase
  const [elimResult, setElimResult] = useState(null); // "safe" | "eliminated"

  const unsubRef = useRef(null);
  const codeRef = useRef(null);
  const prevGameRef = useRef(null);

  const subscribe = useCallback((code) => {
    if (unsubRef.current) unsubRef.current();
    codeRef.current = code;
    unsubRef.current = subscribeGame(code, g => {
      if (g) {
        setGame(prev => { prevGameRef.current = prev; return g; });
      }
    });
  }, []);

  // Watch for elimination result directed at me
  useEffect(() => {
    if (!game || isHost) return;
    const me = game.members?.[myId];
    if (!me) return;
    const prev = prevGameRef.current?.members?.[myId];
    // Just got eliminated
    if (me.eliminated && prev && !prev.eliminated) {
      setElimResult("eliminated");
    }
    // Just got marked safe
    if (me.safe && prev && !prev.safe) {
      setElimResult("safe");
    }
  }, [game, myId, isHost]);

  // Watch for game start to show rol
  useEffect(() => {
    if (!game || isHost) return;
    const prev = prevGameRef.current;
    if (game.status === "playing" && prev?.status === "lobby") {
      setRolShown(true);
    }
  }, [game, isHost]);

  useEffect(() => {
    async function restore() {
      const s = loadSession();
      if (!s) { setRestoring(false); return; }
      const g = await readGame(s.code);
      if (!g || !g.members?.[s.myId]) { clearSession(); setRestoring(false); return; }
      setName(s.name); setIsHost(s.isHost); setGame(g);
      subscribe(s.code);
      setTab(s.isHost ? "spelers" : "overzicht");
      setScreen("game");
      setRestoring(false);
    }
    restore();
  }, []); // eslint-disable-line

  useEffect(() => { return () => { if (unsubRef.current) unsubRef.current(); }; }, []);

  // ─── create ──────────────────────────────────────────────────────────────────
  async function createGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = randCode();
    const g = {
      code, pot: 0, status: "lobby",
      open: createOpen,
      members: {},  // host is NOT a member/speler
      host: myId,
      hostName: name.trim(),
      opdrachten: {},
      test: { open: false, vragen: {}, antwoorden: {} },
      createdAt: Date.now(),
    };
    await writeGame(code, g);
    setGame(g); setIsHost(true); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: true });
    subscribe(code); setTab("spelers"); setScreen("game");
  }

  // ─── spelleider voegt speler handmatig toe ────────────────────────────────
  async function addManualPlayer() {
    if (!manualName.trim()) return;
    const g = await readGame(codeRef.current);
    const id = `p_${Date.now()}`;
    const members = { ...g.members, [id]: { name: manualName.trim(), isMol: false, eliminated: false, safe: false } };
    await updateGame(codeRef.current, { members });
    setManualName("");
  }

  async function removeManualPlayer(id) {
    const g = await readGame(codeRef.current);
    const members = { ...g.members };
    delete members[id];
    await updateGame(codeRef.current, { members });
  }

  // ─── join ─────────────────────────────────────────────────────────────────
  async function joinGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = joinCode.trim().toUpperCase();
    if (!code) return setErr("Voer een code in");
    const g = await readGame(code);
    if (!g) return setErr("Spel niet gevonden – controleer de code");
    if (!g.open) return setErr("Deze party staat gesloten – de spelleider voegt spelers toe");
    if (g.status === "playing") return setErr("Het spel is al begonnen");
    const updated = { ...g, members: { ...g.members, [myId]: { name: name.trim(), isMol: false, eliminated: false, safe: false } } };
    await writeGame(code, updated);
    setGame(updated); setIsHost(false); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: false });
    subscribe(code); setTab("overzicht"); setScreen("game");
  }

  // ─── start game ──────────────────────────────────────────────────────────
  async function startGame() {
    const g = await readGame(codeRef.current);
    if (Object.keys(g.members || {}).length < 1) return setErr("Voeg eerst spelers toe!");
    if (!Object.values(g.members).some(m => m.isMol)) return setErr("Wijs eerst de Mol aan!");
    await updateGame(codeRef.current, { status: "playing" });
    setErr("");
  }

  // ─── set mol ─────────────────────────────────────────────────────────────
  async function setMol(memberId) {
    const g = await readGame(codeRef.current);
    const members = {};
    Object.entries(g.members).forEach(([k, v]) => { members[k] = { ...v, isMol: k === memberId }; });
    await updateGame(codeRef.current, { members });
  }

  // ─── eliminatie ──────────────────────────────────────────────────────────
  async function eliminatePlayer(memberId, eliminate) {
    // eliminate=true → eruit, false → veilig
    await updateGame(codeRef.current, {
      [`members/${memberId}/eliminated`]: eliminate,
      [`members/${memberId}/safe`]: !eliminate,
    });
    // Reset after short delay so it can trigger again next round
    setTimeout(async () => {
      await updateGame(codeRef.current, {
        [`members/${memberId}/safe`]: false,
      });
    }, 8000);
    setShowElimConfirm(false);
    setElimTarget(null);
  }

  // ─── opdrachten ──────────────────────────────────────────────────────────
  async function addOpdracht(o) {
    const g = await readGame(codeRef.current);
    const id = `o_${Date.now()}`;
    const opdrachten = { ...(g.opdrachten || {}), [id]: { ...o, id, verdiend: null, status: "open" } };
    await updateGame(codeRef.current, { opdrachten });
    setNewOpdracht({ titel: "", beschrijving: "", maxBedrag: "" }); setShowDefaults(false);
  }

  async function saveVerdiend(opdrachtId) {
    const bedrag = Number(verdiendeInput[opdrachtId] || 0);
    const g = await readGame(codeRef.current);
    await updateGame(codeRef.current, {
      [`opdrachten/${opdrachtId}/verdiend`]: bedrag,
      [`opdrachten/${opdrachtId}/status`]: "klaar",
      pot: (g.pot || 0) + bedrag,
    });
    setVerdiendeInput(v => ({ ...v, [opdrachtId]: "" }));
  }

  async function deleteOpdracht(id) {
    const g = await readGame(codeRef.current);
    const opdrachten = { ...(g.opdrachten || {}) }; delete opdrachten[id];
    await updateGame(codeRef.current, { opdrachten });
  }

  async function updatePot() {
    if (!potInput) return;
    await updateGame(codeRef.current, { pot: Number(potInput) }); setPotInput("");
  }

  // ─── test ────────────────────────────────────────────────────────────────
  async function addVraag() {
    if (!newVraagTekst.trim()) return;
    const opties = newVraagOpties.filter(o => o.trim());
    if (opties.length < 2) return;
    const g = await readGame(codeRef.current);
    const id = `v_${Date.now()}`;
    const vragen = { ...(g.test?.vragen || {}), [id]: { id, vraag: newVraagTekst.trim(), opties, correct: newVraagCorrect } };
    await updateGame(codeRef.current, { "test/vragen": vragen });
    setNewVraagTekst(""); setNewVraagOpties(["", ""]); setNewVraagCorrect(null);
  }

  async function addDefaultVraag(v) {
    const g = await readGame(codeRef.current);
    const id = `v_${Date.now()}`;
    const vragen = { ...(g.test?.vragen || {}), [id]: { ...v, id } };
    await updateGame(codeRef.current, { "test/vragen": vragen });
    setShowDefaultVragen(false);
  }

  async function deleteVraag(id) {
    const g = await readGame(codeRef.current);
    const vragen = { ...(g.test?.vragen || {}) }; delete vragen[id];
    await updateGame(codeRef.current, { "test/vragen": vragen });
  }

  async function toggleTest(open) {
    await updateGame(codeRef.current, { "test/open": open });
    if (!open) { setTestIngediend(false); setTestAntwoorden({}); }
  }

  async function dienTestIn() {
    await updateGame(codeRef.current, {
      [`test/antwoorden/${myId}`]: { name: game?.members?.[myId]?.name, antwoorden: testAntwoorden }
    });
    setTestIngediend(true);
  }

  function reset() {
    if (unsubRef.current) unsubRef.current();
    clearSession(); codeRef.current = null;
    setGame(null); setIsHost(false); setErr(""); setName(""); setJoinCode("");
    setRolShown(false); setElimResult(null);
    setScreen("home");
  }

  // ─── derived ─────────────────────────────────────────────────────────────
  const members = game?.members ? Object.entries(game.members).map(([id, m]) => ({ id, ...m })) : [];
  const activePlayers = members.filter(m => !m.eliminated);
  const opdrachten = game?.opdrachten ? Object.values(game.opdrachten) : [];
  const vragen = game?.test?.vragen ? Object.values(game.test.vragen) : [];
  const antwoorden = game?.test?.antwoorden ? Object.values(game.test.antwoorden) : [];
  const testOpen = game?.test?.open || false;
  const myMember = game?.members?.[myId];
  const iAmMol = myMember?.isMol || false;
  const iAmEliminated = myMember?.eliminated || false;
  const pot = game?.pot || 0;
  const gameStarted = game?.status === "playing";
  const molVragenMet = MOL_VRAGEN.map((v, i) => i === 0 ? { ...v, opties: members.map(m => m.name) } : v);

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 };
  const btnGold = { background: `linear-gradient(135deg,#b8960c,${C.gold})`, border: "none", borderRadius: 10, color: "#1a1200", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 0", width: "100%", cursor: "pointer" };
  const btnGhost = { background: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, fontFamily: "inherit", fontSize: 14, padding: "11px 0", width: "100%", cursor: "pointer" };
  const btnRed = { background: "linear-gradient(135deg,#8b0000,#c0392b)", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 0", width: "100%", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'EB Garamond',Georgia,serif", minHeight: "100dvh", maxWidth: 430, margin: "0 auto", background: C.bg, color: C.text, overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes fadeInBig{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
        .fa{animation:fadeIn .3s ease both}
        .fab{animation:fadeInBig .4s ease both}
        .btn{border:none;cursor:pointer;transition:all .15s;font-family:inherit}
        .btn:active{transform:scale(.96);opacity:.85}
        input,textarea{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e8e0d0;font-family:inherit;font-size:15px;padding:11px 13px;width:100%;outline:none;resize:vertical}
        input:focus,textarea:focus{border-color:rgba(212,175,55,.5)}
        input::placeholder,textarea::placeholder{color:#3a3530}
      `}</style>

      {/* ══ LOADING ══ */}
      {restoring && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:18 }}>
          <div style={{ width:36,height:36,border:`3px solid ${C.faint}`,borderTop:`3px solid ${C.gold}`,borderRadius:"50%",animation:"spin 1s linear infinite" }}/>
          <div style={{ fontSize:12,color:C.muted,letterSpacing:3 }}>LADEN...</div>
        </div>
      )}

      {/* ══ ELIMINATIE SCHERM (speler) ══ */}
      {!restoring && elimResult && (
        <div className="fab" style={{ position:"fixed",inset:0,zIndex:100,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32, background: elimResult==="safe" ? "linear-gradient(160deg,#001a00,#003300)" : "linear-gradient(160deg,#1a0000,#330000)" }}>
          <div style={{ fontSize:80,marginBottom:24 }}>{elimResult==="safe"?"✅":"❌"}</div>
          <div style={{ fontFamily:"'Cinzel',serif",fontSize:36,fontWeight:700,color:elimResult==="safe"?C.green:C.red,textAlign:"center",marginBottom:16 }}>
            {elimResult==="safe"?"DOOR!" :"ERUIT!"}
          </div>
          <div style={{ fontSize:18,color:elimResult==="safe"?"rgba(46,204,113,.7)":"rgba(192,57,43,.7)",textAlign:"center",fontStyle:"italic",marginBottom:40 }}>
            {elimResult==="safe"?"Je mag door naar de volgende ronde.":"Jij bent de kandidaat die het spel verlaat."}
          </div>
          <button className="btn" onClick={()=>setElimResult(null)} style={{ ...elimResult==="safe"?{...btnGold,background:"linear-gradient(135deg,#006600,#00aa00)",color:"#fff"}:btnRed, width:"auto",padding:"13px 36px",fontSize:17 }}>
            OK
          </button>
        </div>
      )}

      {/* ══ ROL REVEAL (speler, bij start) ══ */}
      {!restoring && rolShown && !elimResult && (
        <div className="fab" style={{ position:"fixed",inset:0,zIndex:99,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32, background: iAmMol ? "linear-gradient(160deg,#1a0800,#2a1000)" : "linear-gradient(160deg,#000a1a,#001020)" }}>
          <div style={{ fontSize:80,marginBottom:20 }}>{iAmMol?"🕵️":"🙋"}</div>
          <div style={{ fontFamily:"'Cinzel',serif",fontSize:11,color:C.muted,letterSpacing:6,marginBottom:8 }}>JOUW ROL IS</div>
          <div style={{ fontFamily:"'Cinzel',serif",fontSize:42,fontWeight:700,color:iAmMol?C.gold:C.text,marginBottom:16,textAlign:"center" }}>
            {iAmMol?"De Mol":"Speler"}
          </div>
          <div style={{ fontSize:16,color:C.muted,textAlign:"center",fontStyle:"italic",lineHeight:1.6,marginBottom:40,maxWidth:280 }}>
            {iAmMol?"Saboteer subtiel. Zorg dat het team zo min mogelijk verdient. Vertrouw op niemand.":"Ontdek wie de Mol is. Vertrouw niemand blind. Elke fout kan de Mol zijn."}
          </div>
          <button className="btn" onClick={()=>setRolShown(false)} style={{ ...btnGold,width:"auto",padding:"13px 36px",fontSize:17 }}>
            Begrepen →
          </button>
        </div>
      )}

      {/* ══ HOME ══ */}
      {!restoring && screen==="home" && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 24px" }}>
          <div className="fa" style={{ textAlign:"center",marginBottom:48 }}>
            <div style={{ fontSize:10,letterSpacing:7,color:C.muted,marginBottom:16 }}>HET SPEL</div>
            <div style={{ fontFamily:"'Cinzel',serif",fontSize:46,fontWeight:700,lineHeight:1.1,color:C.gold,textShadow:`0 0 60px ${C.gold}33` }}>WIE IS<br/>DE MOL?</div>
            <div style={{ display:"flex",justifyContent:"center",gap:7,marginTop:16 }}>
              {[0,1,2].map(i=><div key={i} style={{ width:i===1?28:7,height:2,background:i===1?C.gold:C.faint,borderRadius:2 }}/>)}
            </div>
          </div>

          <div className="fa" style={{ width:"100%",display:"flex",flexDirection:"column",gap:12,animationDelay:".1s" }}>
            <div>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:8 }}>JOUW NAAM (SPELLEIDER)</div>
              <input value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="bijv. Anna" maxLength={18}/>
            </div>

            {/* Party type keuze */}
            <div style={{ ...card, padding:"14px 16px" }}>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:10 }}>TYPE PARTY</div>
              <div style={{ display:"flex",gap:8 }}>
                {[
                  [true,"🌐 Open","Iedereen kan joinen met de code"],
                  [false,"🔒 Gesloten","Spelleider voegt spelers handmatig toe"],
                ].map(([val,label,desc])=>(
                  <button key={String(val)} className="btn" onClick={()=>setCreateOpen(val)} style={{ flex:1,padding:"10px 8px",borderRadius:10,border:`1px solid ${createOpen===val?C.borderGold:C.border}`,background:createOpen===val?"rgba(212,175,55,.1)":"rgba(255,255,255,.04)",cursor:"pointer",textAlign:"center" }}>
                    <div style={{ fontSize:15,marginBottom:3 }}>{label}</div>
                    <div style={{ fontSize:11,color:C.muted,lineHeight:1.4 }}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {err && <div style={{ color:C.red,fontSize:13,textAlign:"center" }}>{err}</div>}
            <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");createGame();}} style={{ ...btnGold,fontSize:17,padding:"15px 0" }}>
              🎭 SPEL AANMAKEN
            </button>

            <div style={{ borderTop:`1px solid ${C.faint}`,paddingTop:12 }}>
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:8 }}>NAAM + CODE OM TE JOINEN</div>
              <input value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="Jouw naam" maxLength={18} style={{ marginBottom:8 }}/>
              <div style={{ display:"flex",gap:10,alignItems:"center" }}>
                <input value={joinCode} onChange={e=>{setJoinCode(e.target.value.toUpperCase());setErr("");}} placeholder="Code (bijv. XK3P2)" maxLength={10} style={{ fontSize:20,letterSpacing:5,textAlign:"center" }}/>
                <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");joinGame();}} style={{ background:"rgba(255,255,255,.09)",border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:15,padding:"11px 18px",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit" }}>
                  JOIN →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ GAME ══ */}
      {!restoring && screen==="game" && game && !rolShown && !elimResult && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column" }}>

          {/* Header */}
          <div style={{ padding:"18px 20px 0",background:"rgba(0,0,0,.5)",borderBottom:`1px solid ${C.faint}`,flexShrink:0 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
              <div>
                <div style={{ fontFamily:"'Cinzel',serif",fontSize:18,color:C.gold }}>
                  {isHost ? "🎭 Spelleider" : iAmEliminated ? "💀 Uitgeschakeld" : iAmMol ? "🕵️ De Mol" : "🙋 Speler"}
                </div>
                <div style={{ fontSize:12,color:C.muted,letterSpacing:1,marginTop:2 }}>
                  {isHost ? game.hostName : myMember?.name} · <span style={{ color:C.gold,letterSpacing:3 }}>{game.code}</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10,color:C.muted,letterSpacing:3 }}>POT</div>
                <div style={{ fontFamily:"'Cinzel',serif",fontSize:26,color:C.goldLight }}>{euro(pot)}</div>
              </div>
            </div>
            <div style={{ display:"flex" }}>
              {(isHost
                ?[["spelers","Spelers"],["opdrachten","Opdrachten"],["test","Test"],["eliminatie","Eliminatie"]]
                :[["overzicht","Overzicht"],["opdrachten","Opdrachten"],["test","Test"]]
              ).map(([t,l])=>(
                <button key={t} className="btn" onClick={()=>setTab(t)} style={{ flex:1,padding:"9px 0",fontSize:12,background:"none",border:"none",borderBottom:tab===t?`2px solid ${C.gold}`:"2px solid transparent",color:tab===t?C.goldLight:C.muted,letterSpacing:.3 }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ flex:1,padding:"16px 18px 100px",overflowY:"auto" }}>

            {/* ═══ SPELLEIDER: SPELERS ═══ */}
            {isHost && tab==="spelers" && (
              <div className="fa">
                {/* Code */}
                <div style={{ ...card,borderColor:C.borderGold,textAlign:"center",padding:"20px 16px" }}>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:5,marginBottom:6 }}>
                    {game.open ? "OPEN PARTY — DEEL CODE MET SPELERS" : "GESLOTEN PARTY — VOEG SPELERS TOE"}
                  </div>
                  <div style={{ fontFamily:"'Cinzel',serif",fontSize:52,color:C.gold,letterSpacing:12 }}>{game.code}</div>
                  <div style={{ fontSize:12,color:C.muted,marginTop:6 }}>
                    {game.open ? "🌐 Iedereen met de code kan joinen" : "🔒 Alleen via spelleider"} · {members.length} speler{members.length!==1?"s":""}
                  </div>
                </div>

                {/* Handmatig toevoegen (gesloten party) */}
                {!game.open && !gameStarted && (
                  <>
                    <Label style={{ marginTop:14 }}>Speler Toevoegen</Label>
                    <div style={{ display:"flex",gap:8,marginBottom:10 }}>
                      <input value={manualName} onChange={e=>setManualName(e.target.value)} placeholder="Naam van speler" onKeyDown={e=>e.key==="Enter"&&addManualPlayer()}/>
                      <button className="btn" onClick={addManualPlayer} style={{ ...btnGold,width:"auto",padding:"11px 18px",fontSize:14 }}>+</button>
                    </div>
                  </>
                )}

                {/* Spelers lijst */}
                <Label style={{ marginTop: game.open || gameStarted ? 14 : 0 }}>Spelers & De Mol</Label>
                {members.length===0 && <div style={{ color:C.muted,fontSize:14,fontStyle:"italic",marginBottom:12 }}>Nog geen spelers.</div>}
                {members.map(m=>(
                  <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12,borderColor:m.isMol?C.borderGold:m.eliminated?"rgba(192,57,43,.3)":C.border,opacity:m.eliminated?.6:1 }}>
                    <div style={{ fontSize:24 }}>{m.eliminated?"💀":m.isMol?"🕵️":"🙋"}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:16,color:m.eliminated?C.muted:m.isMol?C.goldLight:C.text }}>{m.name}</div>
                      <div style={{ fontSize:11,color:m.eliminated?C.red:m.isMol?C.gold:C.muted,letterSpacing:1,marginTop:1 }}>
                        {m.eliminated?"UITGESCHAKELD":m.isMol?"DE MOL":"SPELER"}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:6 }}>
                      {!gameStarted && (
                        <button className="btn" onClick={()=>setMol(m.id)} style={{ background:m.isMol?"rgba(212,175,55,.2)":"rgba(255,255,255,.07)",border:`1px solid ${m.isMol?C.borderGold:C.border}`,borderRadius:8,padding:"6px 10px",fontSize:12,color:m.isMol?C.gold:C.muted,cursor:"pointer" }}>
                          {m.isMol?"✓Mol":"Mol?"}
                        </button>
                      )}
                      {!game.open && !gameStarted && (
                        <button className="btn" onClick={()=>removeManualPlayer(m.id)} style={{ background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"4px" }}>🗑</button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Start game */}
                {!gameStarted ? (
                  <>
                    {err && <div style={{ color:C.red,fontSize:13,textAlign:"center",marginBottom:8 }}>{err}</div>}
                    <button className="btn" onClick={startGame} style={{ ...btnGold,marginTop:8,fontSize:17,padding:"15px 0" }}>
                      🚀 SPEL STARTEN
                    </button>
                  </>
                ) : (
                  <div style={{ ...card,borderColor:C.borderGreen,textAlign:"center",marginTop:8 }}>
                    <div style={{ fontSize:13,color:C.green,letterSpacing:2 }}>🟢 SPEL BEZIG</div>
                  </div>
                )}

                {/* Pot */}
                <Label style={{ marginTop:20 }}>Pot Aanpassen</Label>
                <div style={{ display:"flex",gap:8 }}>
                  <input type="number" value={potInput} onChange={e=>setPotInput(e.target.value)} placeholder={`Huidig: ${euro(pot)}`}/>
                  <button className="btn" onClick={updatePot} style={{ ...btnGold,width:"auto",padding:"11px 20px",fontSize:14 }}>OK</button>
                </div>

                <button className="btn" onClick={reset} style={{ ...btnGhost,marginTop:24 }}>Spel verlaten</button>
              </div>
            )}

            {/* ═══ SPELLEIDER: ELIMINATIE ═══ */}
            {isHost && tab==="eliminatie" && (
              <div className="fa">
                <Label>Kandidaat Kiezen</Label>
                <div style={{ fontSize:13,color:C.muted,fontStyle:"italic",marginBottom:12 }}>Kies een speler om te elimineren of veilig te stellen. De speler krijgt een melding op zijn scherm.</div>

                {activePlayers.length===0
                  ? <div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"30px 0",fontStyle:"italic" }}>Geen actieve spelers.</div>
                  : activePlayers.map(m=>(
                    <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12 }}>
                      <div style={{ fontSize:24 }}>🙋</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:16 }}>{m.name}</div>
                        {m.isMol && <div style={{ fontSize:11,color:C.gold,letterSpacing:1 }}>DE MOL</div>}
                      </div>
                      <div style={{ display:"flex",gap:6 }}>
                        <button className="btn" onClick={()=>{setElimTarget({...m,action:"safe"});setShowElimConfirm(true);}} style={{ background:"rgba(46,204,113,.15)",border:"1px solid rgba(46,204,113,.3)",borderRadius:8,padding:"7px 12px",fontSize:13,color:C.green,cursor:"pointer" }}>
                          ✓ Veilig
                        </button>
                        <button className="btn" onClick={()=>{setElimTarget({...m,action:"eliminate"});setShowElimConfirm(true);}} style={{ background:"rgba(192,57,43,.15)",border:"1px solid rgba(192,57,43,.3)",borderRadius:8,padding:"7px 12px",fontSize:13,color:C.red,cursor:"pointer" }}>
                          ✗ Eruit
                        </button>
                      </div>
                    </div>
                  ))
                }

                {/* Uitgeschakelde spelers */}
                {members.filter(m=>m.eliminated).length>0 && (
                  <>
                    <Label style={{ marginTop:16 }}>Uitgeschakeld</Label>
                    {members.filter(m=>m.eliminated).map(m=>(
                      <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12,opacity:.5,borderColor:"rgba(192,57,43,.2)" }}>
                        <div style={{ fontSize:22 }}>💀</div>
                        <div style={{ fontSize:15,color:C.muted }}>{m.name}</div>
                      </div>
                    ))}
                  </>
                )}

                {/* Bevestigingsdialoog */}
                {showElimConfirm && elimTarget && (
                  <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,padding:24 }}>
                    <div style={{ background:"#161210",border:`1px solid ${elimTarget.action==="eliminate"?"rgba(192,57,43,.4)":"rgba(46,204,113,.4)"}`,borderRadius:16,padding:28,width:"100%",maxWidth:360,textAlign:"center" }}>
                      <div style={{ fontSize:42,marginBottom:14 }}>{elimTarget.action==="eliminate"?"❌":"✅"}</div>
                      <div style={{ fontFamily:"'Cinzel',serif",fontSize:18,color:elimTarget.action==="eliminate"?C.red:C.green,marginBottom:12 }}>
                        {elimTarget.action==="eliminate"?"Elimineren":"Veilig stellen"}
                      </div>
                      <div style={{ fontSize:15,color:C.muted,marginBottom:24 }}>
                        Weet je zeker dat je <span style={{ color:C.text }}>{elimTarget.name}</span> {elimTarget.action==="eliminate"?"wilt elimineren?":"veilig wilt stellen?"}
                      </div>
                      <div style={{ display:"flex",gap:10 }}>
                        <button className="btn" onClick={()=>{setShowElimConfirm(false);setElimTarget(null);}} style={{ ...btnGhost,flex:1 }}>Annuleer</button>
                        <button className="btn" onClick={()=>eliminatePlayer(elimTarget.id,elimTarget.action==="eliminate")} style={{ ...(elimTarget.action==="eliminate"?btnRed:btnGold),flex:1 }}>
                          Bevestig
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ SPELLEIDER: OPDRACHTEN ═══ */}
            {isHost && tab==="opdrachten" && (
              <div className="fa">
                <Label>Eigen Opdracht Invoeren</Label>
                <div style={card}>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    <input value={newOpdracht.titel} onChange={e=>setNewOpdracht(o=>({...o,titel:e.target.value}))} placeholder="Titel van de opdracht"/>
                    <textarea rows={3} value={newOpdracht.beschrijving} onChange={e=>setNewOpdracht(o=>({...o,beschrijving:e.target.value}))} placeholder="Beschrijving / spelregels..."/>
                    <input type="number" value={newOpdracht.maxBedrag} onChange={e=>setNewOpdracht(o=>({...o,maxBedrag:e.target.value}))} placeholder="Maximaal te verdienen (€)"/>
                    <button className="btn" onClick={()=>{if(!newOpdracht.titel.trim()||!newOpdracht.maxBedrag)return;addOpdracht({...newOpdracht,maxBedrag:Number(newOpdracht.maxBedrag)});}} style={btnGold}>
                      + OPDRACHT TOEVOEGEN
                    </button>
                  </div>
                </div>

                <button className="btn" onClick={()=>setShowDefaults(v=>!v)} style={{ ...btnGhost,marginBottom:10 }}>
                  {showDefaults?"▲ Verberg standaard opdrachten":"▼ Kies uit standaard opdrachten (AI)"}
                </button>
                {showDefaults && DEFAULT_OPDRACHTEN.map((o,i)=>(
                  <div key={i} style={{ ...card,borderColor:C.borderGold }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:C.goldLight,marginBottom:5 }}>{o.titel}</div>
                        <div style={{ fontSize:13,color:C.muted,lineHeight:1.6 }}>{o.beschrijving}</div>
                        <div style={{ fontSize:12,color:C.gold,marginTop:6 }}>Max: {euro(o.maxBedrag)}</div>
                      </div>
                      <button className="btn" onClick={()=>addOpdracht(o)} style={{ background:"rgba(212,175,55,.12)",border:`1px solid ${C.borderGold}`,borderRadius:8,padding:"8px 12px",color:C.gold,fontSize:13,cursor:"pointer",whiteSpace:"nowrap" }}>
                        + Voeg toe
                      </button>
                    </div>
                  </div>
                ))}

                {opdrachten.length>0 && (
                  <>
                    <Label style={{ marginTop:20 }}>Actieve Opdrachten</Label>
                    {opdrachten.map(o=>(
                      <div key={o.id} style={{ ...card,borderColor:o.status==="klaar"?C.borderGreen:C.border }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 }}>
                          <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:o.status==="klaar"?C.green:C.goldLight,flex:1 }}>{o.titel}</div>
                          <button className="btn" onClick={()=>deleteOpdracht(o.id)} style={{ background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"0 4px" }}>🗑</button>
                        </div>
                        <div style={{ fontSize:13,color:C.muted,lineHeight:1.5,marginBottom:8 }}>{o.beschrijving}</div>
                        <div style={{ fontSize:13,color:C.gold }}>Max: {euro(o.maxBedrag)}</div>
                        {o.status==="klaar"
                          ?<div style={{ marginTop:8,fontSize:14,color:C.green }}>✓ Verdiend: {euro(o.verdiend)} — in pot gezet</div>
                          :<div style={{ display:"flex",gap:8,marginTop:10 }}>
                            <input type="number" value={verdiendeInput[o.id]||""} onChange={e=>setVerdiendeInput(v=>({...v,[o.id]:e.target.value}))} placeholder={`Verdiend (max ${euro(o.maxBedrag)})`} style={{ fontSize:14 }}/>
                            <button className="btn" onClick={()=>saveVerdiend(o.id)} style={{ ...btnGold,width:"auto",padding:"11px 16px",fontSize:14 }}>+ Pot</button>
                          </div>
                        }
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ═══ SPELLEIDER: TEST ═══ */}
            {isHost && tab==="test" && (
              <div className="fa">
                <div style={{ ...card,borderColor:testOpen?C.borderGreen:C.border,textAlign:"center",padding:"20px 16px" }}>
                  <div style={{ fontSize:13,color:testOpen?C.green:C.muted,letterSpacing:2,marginBottom:12 }}>
                    {testOpen?"🟢 TEST IS OPEN":"🔴 TEST IS GESLOTEN"}
                  </div>
                  <button className="btn" onClick={()=>toggleTest(!testOpen)} style={{ ...(testOpen?btnGhost:btnGold),width:"auto",padding:"10px 28px",fontSize:15 }}>
                    {testOpen?"Test sluiten":"Test openen voor spelers"}
                  </button>
                </div>

                {antwoorden.length>0 && (
                  <>
                    <Label style={{ marginTop:16 }}>Ingediend ({antwoorden.length}/{members.length})</Label>
                    {antwoorden.map((a,i)=>(
                      <div key={i} style={{ ...card,borderColor:C.borderGold }}>
                        <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:C.goldLight,marginBottom:10 }}>{a.name}</div>
                        {Object.entries(a.antwoorden||{}).map(([qId,ant])=>{
                          const v=vragen.find(v=>v.id===qId);
                          const isCorrect = v?.correct && v.correct===ant;
                          return(
                            <div key={qId} style={{ fontSize:13,padding:"4px 0",borderBottom:`1px solid ${C.faint}`,color:C.muted }}>
                              <span style={{ color:C.text }}>{v?.vraag||"?"}</span>
                              <span style={{ color:isCorrect?C.green:C.gold,marginLeft:8 }}>→ {ant} {isCorrect?"✓":""}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </>
                )}

                <Label style={{ marginTop:18 }}>Eigen Vraag Toevoegen</Label>
                <div style={card}>
                  <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                    <input value={newVraagTekst} onChange={e=>setNewVraagTekst(e.target.value)} placeholder="Jouw vraag..."/>
                    <div style={{ fontSize:11,color:C.muted,letterSpacing:2,marginTop:4 }}>ANTWOORDOPTIES (min. 2) — tik ✓ voor het goede antwoord</div>
                    {newVraagOpties.map((opt,i)=>(
                      <div key={i} style={{ display:"flex",gap:8,alignItems:"center" }}>
                        <input value={opt} onChange={e=>setNewVraagOpties(o=>{const n=[...o];n[i]=e.target.value;return n;})} placeholder={`Optie ${i+1}`} style={{ flex:1 }}/>
                        <button className="btn" onClick={()=>setNewVraagCorrect(opt||null)} style={{ background:newVraagCorrect===opt&&opt?"rgba(46,204,113,.2)":"rgba(255,255,255,.07)",border:`1px solid ${newVraagCorrect===opt&&opt?"rgba(46,204,113,.4)":C.border}`,borderRadius:8,padding:"9px 12px",color:newVraagCorrect===opt&&opt?C.green:C.muted,cursor:"pointer",fontSize:14,flexShrink:0 }}>✓</button>
                        {i>=2&&<button className="btn" onClick={()=>setNewVraagOpties(o=>o.filter((_,j)=>j!==i))} style={{ background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16,flexShrink:0 }}>✕</button>}
                      </div>
                    ))}
                    <button className="btn" onClick={()=>setNewVraagOpties(o=>[...o,""])} style={{ ...btnGhost,fontSize:13,padding:"8px 0" }}>+ Optie toevoegen</button>
                    <button className="btn" onClick={addVraag} style={btnGold}>+ VRAAG TOEVOEGEN</button>
                  </div>
                </div>

                <button className="btn" onClick={()=>setShowDefaultVragen(v=>!v)} style={{ ...btnGhost,marginBottom:10 }}>
                  {showDefaultVragen?"▲ Verberg":"▼ Standaard mol-vragen"}
                </button>
                {showDefaultVragen && molVragenMet.map((v,i)=>(
                  <div key={i} style={{ ...card,borderColor:C.borderGold }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14,color:C.text,marginBottom:3 }}>{v.vraag}</div>
                        <div style={{ fontSize:12,color:C.muted }}>{v.opties.join(" · ")}</div>
                      </div>
                      <button className="btn" onClick={()=>addDefaultVraag(v)} style={{ background:"rgba(212,175,55,.1)",border:`1px solid ${C.borderGold}`,borderRadius:8,padding:"7px 12px",color:C.gold,fontSize:13,cursor:"pointer" }}>
                        + Voeg toe
                      </button>
                    </div>
                  </div>
                ))}

                {vragen.length>0 && (
                  <>
                    <Label style={{ marginTop:16 }}>Huidige Vragen ({vragen.length})</Label>
                    {vragen.map((v,i)=>(
                      <div key={v.id} style={card}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:14,color:C.text,marginBottom:4 }}>{i+1}. {v.vraag}</div>
                            {(v.opties||[]).map((o,j)=>(
                              <div key={j} style={{ fontSize:12,color:v.correct===o?C.green:C.muted,marginTop:2 }}>
                                {v.correct===o?"✓ ":"• "}{o}
                              </div>
                            ))}
                          </div>
                          <button className="btn" onClick={()=>deleteVraag(v.id)} style={{ background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"0 4px" }}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ═══ SPELER: OVERZICHT ═══ */}
            {!isHost && tab==="overzicht" && (
              <div className="fa">
                {!gameStarted ? (
                  <div style={{ ...card,textAlign:"center",padding:"30px 16px",borderColor:C.borderGold }}>
                    <div style={{ fontSize:36,marginBottom:12 }}>⏳</div>
                    <div style={{ fontFamily:"'Cinzel',serif",fontSize:18,color:C.gold }}>Wachten op spelleider...</div>
                    <div style={{ fontSize:13,color:C.muted,marginTop:8,fontStyle:"italic" }}>Het spel is nog niet gestart.</div>
                  </div>
                ) : (
                  <div style={{ ...card,borderColor:C.borderGold,textAlign:"center",padding:"28px 16px" }}>
                    <div style={{ fontSize:10,color:C.muted,letterSpacing:5,marginBottom:8 }}>POT</div>
                    <div style={{ fontFamily:"'Cinzel',serif",fontSize:58,color:C.goldLight,textShadow:`0 0 40px ${C.gold}44` }}>{euro(pot)}</div>
                  </div>
                )}

                <Label style={{ marginTop:16 }}>Mededeelnemers</Label>
                {members.filter(m=>m.id!==myId).map(m=>(
                  <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12,opacity:m.eliminated?.5:1,borderColor:m.eliminated?"rgba(192,57,43,.2)":C.border }}>
                    <div style={{ fontSize:22 }}>{m.eliminated?"💀":"🙋"}</div>
                    <div>
                      <div style={{ fontSize:16,color:m.eliminated?C.muted:C.text }}>{m.name}</div>
                      {m.eliminated && <div style={{ fontSize:11,color:C.red,letterSpacing:1 }}>UITGESCHAKELD</div>}
                    </div>
                  </div>
                ))}

                {testOpen&&!testIngediend&&(
                  <div style={{ ...card,borderColor:C.borderGreen,textAlign:"center",marginTop:8,animation:"pulse 2s infinite" }}>
                    <div style={{ fontSize:14,color:C.green,marginBottom:10 }}>🟢 De test staat open!</div>
                    <button className="btn" onClick={()=>setTab("test")} style={{ ...btnGold,width:"auto",padding:"9px 24px",fontSize:14 }}>Naar de test →</button>
                  </div>
                )}

                <button className="btn" onClick={reset} style={{ ...btnGhost,marginTop:24 }}>Spel verlaten</button>
              </div>
            )}

            {/* ═══ SPELER: OPDRACHTEN ═══ */}
            {!isHost && tab==="opdrachten" && (
              <div className="fa">
                <Label>Opdrachten</Label>
                {!gameStarted
                  ?<div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"36px 0",fontStyle:"italic" }}>Het spel is nog niet gestart.</div>
                  :opdrachten.length===0
                    ?<div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"36px 0",fontStyle:"italic" }}>Nog geen opdrachten toegevoegd.</div>
                    :opdrachten.map(o=>(
                      <div key={o.id} style={{ ...card,borderColor:o.status==="klaar"?C.borderGreen:C.border }}>
                        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                          <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:o.status==="klaar"?C.green:C.goldLight }}>{o.titel}</div>
                          <div style={{ fontSize:11,color:o.status==="klaar"?C.green:C.gold,letterSpacing:1 }}>{o.status==="klaar"?"✓ KLAAR":"OPEN"}</div>
                        </div>
                        <div style={{ fontSize:13,color:C.muted,lineHeight:1.6,marginBottom:6 }}>{o.beschrijving}</div>
                        <div style={{ fontSize:13,color:C.gold }}>
                          Max: {euro(o.maxBedrag)}
                          {o.status==="klaar"&&<span style={{ color:C.green,marginLeft:14 }}>Verdiend: {euro(o.verdiend)}</span>}
                        </div>
                      </div>
                    ))
                }
              </div>
            )}

            {/* ═══ SPELER: TEST ═══ */}
            {!isHost && tab==="test" && (
              <div className="fa">
                <Label>De Test</Label>
                {!testOpen
                  ?<div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"36px 0",fontStyle:"italic" }}>🔒 De spelleider heeft de test nog niet geopend.</div>
                  :testIngediend
                    ?<div style={{ ...card,textAlign:"center",padding:"36px 16px",borderColor:C.borderGreen }}>
                        <div style={{ fontSize:48,marginBottom:14 }}>✅</div>
                        <div style={{ fontFamily:"'Cinzel',serif",fontSize:20,color:C.green }}>Ingediend!</div>
                        <div style={{ fontSize:13,color:C.muted,marginTop:8,fontStyle:"italic" }}>Wacht op de spelleider.</div>
                      </div>
                    :vragen.length===0
                      ?<div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"36px 0",fontStyle:"italic" }}>Geen vragen toegevoegd.</div>
                      :<div>
                        <div style={{ fontSize:13,color:C.muted,marginBottom:16,fontStyle:"italic" }}>Beantwoord alle {vragen.length} vragen en dien de test in.</div>
                        {vragen.map((v,i)=>(
                          <div key={v.id} style={{ ...card,borderColor:testAntwoorden[v.id]?C.borderGold:C.border }}>
                            <div style={{ fontSize:14,color:C.text,marginBottom:12,lineHeight:1.5 }}>
                              <span style={{ color:C.muted,fontSize:12,marginRight:6 }}>{i+1}.</span>{v.vraag}
                            </div>
                            <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                              {(v.opties||[]).map((opt,j)=>(
                                <button key={j} className="btn" onClick={()=>setTestAntwoorden(a=>({...a,[v.id]:opt}))} style={{ padding:"11px 14px",borderRadius:10,textAlign:"left",fontSize:14,background:testAntwoorden[v.id]===opt?"rgba(212,175,55,.15)":"rgba(255,255,255,.05)",border:`1px solid ${testAntwoorden[v.id]===opt?C.borderGold:C.border}`,color:testAntwoorden[v.id]===opt?C.goldLight:C.text,cursor:"pointer" }}>
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <button className="btn" onClick={dienTestIn} style={{ ...btnGold,marginTop:8,opacity:Object.keys(testAntwoorden).length<vragen.length?.5:1 }}>
                          {Object.keys(testAntwoorden).length<vragen.length?`Nog ${vragen.length-Object.keys(testAntwoorden).length} vraag/vragen open`:"✓ TEST INDIENEN"}
                        </button>
                      </div>
                }
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children, style }) {
  return <div style={{ fontFamily:"'Cinzel',serif",fontSize:12,color:"#d4af37",letterSpacing:2.5,marginBottom:10,marginTop:4,...style }}>{children}</div>;
}
