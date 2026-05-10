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
  { vraag: "Wie is de Mol?", opties: [] },
  { vraag: "Wat is het haar van de Mol?", opties: ["Donker", "Blond", "Rood", "Grijs / Wit"] },
  { vraag: "Welk geslacht heeft de Mol?", opties: ["Man", "Vrouw", "Anders"] },
  { vraag: "Droeg de Mol vandaag iets rods?", opties: ["Ja", "Nee", "Weet ik niet"] },
  { vraag: "Hoe oud schat jij de Mol?", opties: ["Onder de 25", "25–35", "35–45", "Boven de 45"] },
  { vraag: "Saboteerde de Mol actief tijdens een opdracht?", opties: ["Ja, duidelijk", "Misschien", "Nee"] },
  { vraag: "Maakte de Mol een opvallende fout?", opties: ["Ja", "Nee"] },
  { vraag: "Hoe staat de Mol in de groep?", opties: ["Leider", "Volger", "Buitenstaander"] },
  { vraag: "Hoe zeker ben jij van je antwoord op vraag 1?", opties: ["Heel zeker", "Redelijk zeker", "Gok"] },
  { vraag: "Vertrouw jij de Mol in het dagelijks leven?", opties: ["Ja", "Nee", "Twijfel"] },
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

  // spelleider
  const [newOpdracht, setNewOpdracht] = useState({ titel: "", beschrijving: "", maxBedrag: "" });
  const [showDefaults, setShowDefaults] = useState(false);
  const [verdiendeInput, setVerdiendeInput] = useState({});
  const [newVraag, setNewVraag] = useState({ vraag: "", opties: ["", "", "", ""] });
  const [showDefaultVragen, setShowDefaultVragen] = useState(false);
  const [potInput, setPotInput] = useState("");

  // speler
  const [testAntwoorden, setTestAntwoorden] = useState({});
  const [testIngediend, setTestIngediend] = useState(false);

  const unsubRef = useRef(null);
  const codeRef = useRef(null);

  const subscribe = useCallback((code) => {
    if (unsubRef.current) unsubRef.current();
    codeRef.current = code;
    unsubRef.current = subscribeGame(code, g => { if (g) setGame(g); });
  }, []);

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

  async function createGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = randCode();
    const g = { code, pot: 0, members: { [myId]: { name: name.trim(), isMol: false } }, host: myId, opdrachten: {}, test: { open: false, vragen: {}, antwoorden: {} }, createdAt: Date.now() };
    await writeGame(code, g);
    setGame(g); setIsHost(true); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: true });
    subscribe(code); setTab("spelers"); setScreen("game");
  }

  async function joinGame() {
    if (!name.trim()) return setErr("Voer een naam in");
    const code = joinCode.trim().toUpperCase();
    if (!code) return setErr("Voer een code in");
    const g = await readGame(code);
    if (!g) return setErr("Spel niet gevonden – controleer de code");
    const updated = { ...g, members: { ...g.members, [myId]: { name: name.trim(), isMol: false } } };
    await writeGame(code, updated);
    setGame(updated); setIsHost(false); setErr("");
    saveSession({ code, myId, name: name.trim(), isHost: false });
    subscribe(code); setTab("overzicht"); setScreen("game");
  }

  async function setMol(memberId) {
    const g = await readGame(codeRef.current);
    const members = {};
    Object.entries(g.members).forEach(([k, v]) => { members[k] = { ...v, isMol: k === memberId }; });
    await updateGame(codeRef.current, { members });
  }

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
    await updateGame(codeRef.current, { [`opdrachten/${opdrachtId}/verdiend`]: bedrag, [`opdrachten/${opdrachtId}/status`]: "klaar", pot: (g.pot || 0) + bedrag });
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

  async function addVraag(v) {
    const g = await readGame(codeRef.current);
    const id = `v_${Date.now()}`;
    const vragen = { ...(g.test?.vragen || {}), [id]: { ...v, id } };
    await updateGame(codeRef.current, { "test/vragen": vragen });
    setNewVraag({ vraag: "", opties: ["", "", "", ""] }); setShowDefaultVragen(false);
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
    await updateGame(codeRef.current, { [`test/antwoorden/${myId}`]: { name: game?.members?.[myId]?.name, antwoorden: testAntwoorden } });
    setTestIngediend(true);
  }

  function reset() {
    if (unsubRef.current) unsubRef.current();
    clearSession(); codeRef.current = null;
    setGame(null); setIsHost(false); setErr(""); setName(""); setJoinCode("");
    setScreen("home");
  }

  const members = game?.members ? Object.entries(game.members).map(([id, m]) => ({ id, ...m })) : [];
  const opdrachten = game?.opdrachten ? Object.values(game.opdrachten) : [];
  const vragen = game?.test?.vragen ? Object.values(game.test.vragen) : [];
  const antwoorden = game?.test?.antwoorden ? Object.values(game.test.antwoorden) : [];
  const testOpen = game?.test?.open || false;
  const myMember = game?.members?.[myId];
  const iAmMol = myMember?.isMol || false;
  const pot = game?.pot || 0;
  const molVragenMet = MOL_VRAGEN.map((v, i) => i === 0 ? { ...v, opties: members.map(m => m.name) } : v);

  const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 10 };
  const inp = { background: "rgba(255,255,255,.07)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontFamily: "inherit", fontSize: 15, padding: "11px 13px", width: "100%", outline: "none" };
  const btnGold = { background: `linear-gradient(135deg,#b8960c,${C.gold})`, border: "none", borderRadius: 10, color: "#1a1200", fontFamily: "inherit", fontWeight: 700, fontSize: 15, padding: "12px 0", width: "100%", cursor: "pointer" };
  const btnGhost = { background: "rgba(255,255,255,.06)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, fontFamily: "inherit", fontSize: 14, padding: "11px 0", width: "100%", cursor: "pointer" };

  return (
    <div style={{ fontFamily: "'EB Garamond',Georgia,serif", minHeight: "100dvh", maxWidth: 430, margin: "0 auto", background: C.bg, color: C.text, overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0}
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .fa{animation:fadeIn .3s ease both}
        .btn{border:none;cursor:pointer;transition:all .15s;font-family:inherit}
        .btn:active{transform:scale(.96);opacity:.85}
        input,textarea{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);border-radius:10px;color:#e8e0d0;font-family:inherit;font-size:15px;padding:11px 13px;width:100%;outline:none;resize:vertical}
        input:focus,textarea:focus{border-color:rgba(212,175,55,.5)}
        input::placeholder,textarea::placeholder{color:#3a3530}
      `}</style>

      {/* LOADING */}
      {restoring && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:18 }}>
          <div style={{ width:36,height:36,border:`3px solid ${C.faint}`,borderTop:`3px solid ${C.gold}`,borderRadius:"50%",animation:"spin 1s linear infinite" }} />
          <div style={{ fontSize:12,color:C.muted,letterSpacing:3 }}>LADEN...</div>
        </div>
      )}

      {/* HOME */}
      {!restoring && screen === "home" && (
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
              <div style={{ fontSize:11,color:C.muted,letterSpacing:3,marginBottom:8 }}>JOUW NAAM</div>
              <input value={name} onChange={e=>{setName(e.target.value);setErr("");}} placeholder="bijv. Anna" maxLength={18}/>
            </div>
            {err && <div style={{ color:C.red,fontSize:13,textAlign:"center" }}>{err}</div>}
            <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");createGame();}} style={{ ...btnGold,fontSize:17,padding:"15px 0" }}>
              🎭 SPEL AANMAKEN
            </button>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}>
              <input value={joinCode} onChange={e=>{setJoinCode(e.target.value.toUpperCase());setErr("");}} placeholder="Code (bijv. XK3P2)" maxLength={10} style={{ fontSize:20,letterSpacing:5,textAlign:"center" }}/>
              <button className="btn" onClick={()=>{if(!name.trim())return setErr("Voer eerst een naam in");joinGame();}} style={{ background:"rgba(255,255,255,.09)",border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:15,padding:"11px 18px",cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit" }}>
                JOIN →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GAME */}
      {!restoring && screen === "game" && game && (
        <div style={{ minHeight:"100dvh",display:"flex",flexDirection:"column" }}>

          {/* Header */}
          <div style={{ padding:"18px 20px 0",background:"rgba(0,0,0,.5)",borderBottom:`1px solid ${C.faint}`,flexShrink:0 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
              <div>
                <div style={{ fontFamily:"'Cinzel',serif",fontSize:18,color:C.gold }}>
                  {isHost?"🎭 Spelleider":iAmMol?"🕵️ De Mol":"🙋 Speler"}
                </div>
                <div style={{ fontSize:12,color:C.muted,letterSpacing:1,marginTop:2 }}>
                  {myMember?.name} · <span style={{ color:C.gold,letterSpacing:3 }}>{game.code}</span>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:10,color:C.muted,letterSpacing:3 }}>POT</div>
                <div style={{ fontFamily:"'Cinzel',serif",fontSize:26,color:C.goldLight }}>{euro(pot)}</div>
              </div>
            </div>
            <div style={{ display:"flex" }}>
              {(isHost
                ?[["spelers","Spelers"],["opdrachten","Opdrachten"],["test","Test"]]
                :[["overzicht","Overzicht"],["opdrachten","Opdrachten"],["test","Test"]]
              ).map(([t,l])=>(
                <button key={t} className="btn" onClick={()=>setTab(t)} style={{ flex:1,padding:"9px 0",fontSize:13,background:"none",border:"none",borderBottom:tab===t?`2px solid ${C.gold}`:"2px solid transparent",color:tab===t?C.goldLight:C.muted,letterSpacing:.5 }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ flex:1,padding:"16px 18px 100px",overflowY:"auto" }}>

            {/* ═══ SPELLEIDER: SPELERS ═══ */}
            {isHost && tab==="spelers" && (
              <div className="fa">
                <div style={{ ...card,borderColor:C.borderGold,textAlign:"center",padding:"20px 16px" }}>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:5,marginBottom:6 }}>PARTYCODE — DEEL MET VRIENDEN</div>
                  <div style={{ fontFamily:"'Cinzel',serif",fontSize:52,color:C.gold,letterSpacing:12,textShadow:`0 0 30px ${C.gold}44` }}>{game.code}</div>
                  <div style={{ fontSize:12,color:C.muted,marginTop:6 }}>{members.length} speler{members.length!==1?"s":""}</div>
                </div>

                <Label style={{ marginTop:16 }}>Spelers & De Mol</Label>
                <div style={{ fontSize:12,color:C.muted,marginBottom:10,fontStyle:"italic" }}>Tik op "Mol?" om iemand de Mol te maken.</div>
                {members.map(m=>(
                  <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12,borderColor:m.isMol?C.borderGold:C.border }}>
                    <div style={{ fontSize:24 }}>{m.isMol?"🕵️":"🙋"}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:16,color:m.isMol?C.goldLight:C.text }}>{m.name}{m.id===myId?" (jij)":""}</div>
                      <div style={{ fontSize:11,color:m.isMol?C.gold:C.muted,letterSpacing:1,marginTop:1 }}>{m.isMol?"DE MOL":"SPELER"}</div>
                    </div>
                    <button className="btn" onClick={()=>setMol(m.id)} style={{ background:m.isMol?"rgba(212,175,55,.2)":"rgba(255,255,255,.07)",border:`1px solid ${m.isMol?C.borderGold:C.border}`,borderRadius:8,padding:"7px 14px",fontSize:13,color:m.isMol?C.gold:C.muted,cursor:"pointer" }}>
                      {m.isMol?"✓ Mol":"Mol?"}
                    </button>
                  </div>
                ))}

                <Label style={{ marginTop:20 }}>Pot Aanpassen</Label>
                <div style={{ display:"flex",gap:8 }}>
                  <input type="number" value={potInput} onChange={e=>setPotInput(e.target.value)} placeholder={`Huidig: ${euro(pot)}`}/>
                  <button className="btn" onClick={updatePot} style={{ ...btnGold,width:"auto",padding:"11px 20px",fontSize:14 }}>OK</button>
                </div>

                <button className="btn" onClick={reset} style={{ ...btnGhost,marginTop:28 }}>Spel verlaten</button>
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
                    <Label style={{ marginTop:16 }}>Ingediend ({antwoorden.length} / {members.length-1})</Label>
                    {antwoorden.map((a,i)=>(
                      <div key={i} style={{ ...card,borderColor:C.borderGold }}>
                        <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:C.goldLight,marginBottom:10 }}>{a.name}</div>
                        {Object.entries(a.antwoorden||{}).map(([qId,ant])=>{
                          const v=vragen.find(v=>v.id===qId);
                          return(
                            <div key={qId} style={{ fontSize:13,padding:"4px 0",borderBottom:`1px solid ${C.faint}`,color:C.muted }}>
                              <span style={{ color:C.text }}>{v?.vraag||"?"}</span>
                              <span style={{ color:C.gold,marginLeft:8 }}>→ {ant}</span>
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
                    <input value={newVraag.vraag} onChange={e=>setNewVraag(v=>({...v,vraag:e.target.value}))} placeholder="Jouw vraag..."/>
                    {newVraag.opties.map((opt,i)=>(
                      <input key={i} value={opt} onChange={e=>setNewVraag(v=>{const o=[...v.opties];o[i]=e.target.value;return{...v,opties:o};})} placeholder={`Antwoordoptie ${i+1}`}/>
                    ))}
                    <button className="btn" onClick={()=>{if(!newVraag.vraag.trim())return;addVraag({...newVraag,opties:newVraag.opties.filter(Boolean)});}} style={btnGold}>
                      + VRAAG TOEVOEGEN
                    </button>
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
                      <button className="btn" onClick={()=>addVraag(v)} style={{ background:"rgba(212,175,55,.1)",border:`1px solid ${C.borderGold}`,borderRadius:8,padding:"7px 12px",color:C.gold,fontSize:13,cursor:"pointer" }}>
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
                            <div style={{ fontSize:14,color:C.text }}>{i+1}. {v.vraag}</div>
                            <div style={{ fontSize:12,color:C.muted,marginTop:4 }}>{(v.opties||[]).join(" · ")}</div>
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
                <div style={{ ...card,borderColor:C.borderGold,textAlign:"center",padding:"28px 16px" }}>
                  <div style={{ fontSize:10,color:C.muted,letterSpacing:5,marginBottom:8 }}>POT</div>
                  <div style={{ fontFamily:"'Cinzel',serif",fontSize:58,color:C.goldLight,textShadow:`0 0 40px ${C.gold}44` }}>{euro(pot)}</div>
                </div>

                <div style={{ ...card,borderColor:iAmMol?C.borderGold:C.border }}>
                  <Label>Jouw Rol</Label>
                  <div style={{ display:"flex",alignItems:"center",gap:14 }}>
                    <div style={{ fontSize:40 }}>{iAmMol?"🕵️":"🙋"}</div>
                    <div>
                      <div style={{ fontFamily:"'Cinzel',serif",fontSize:22,color:iAmMol?C.gold:C.text }}>{iAmMol?"De Mol":"Speler"}</div>
                      <div style={{ fontSize:13,color:C.muted,marginTop:4,fontStyle:"italic",lineHeight:1.5 }}>
                        {iAmMol?"Saboteer subtiel – zorg dat het team zo min mogelijk verdient.":"Ontdek wie de Mol is. Vertrouw niemand blind."}
                      </div>
                    </div>
                  </div>
                </div>

                <Label style={{ marginTop:16 }}>Mededeelnemers</Label>
                {members.filter(m=>m.id!==myId).map(m=>(
                  <div key={m.id} style={{ ...card,display:"flex",alignItems:"center",gap:12 }}>
                    <div style={{ fontSize:22 }}>🙋</div>
                    <div style={{ fontSize:16 }}>{m.name}</div>
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
                {opdrachten.length===0
                  ?<div style={{ color:C.muted,fontSize:14,textAlign:"center",padding:"36px 0",fontStyle:"italic" }}>De spelleider heeft nog geen opdrachten toegevoegd.</div>
                  :opdrachten.map(o=>(
                    <div key={o.id} style={{ ...card,borderColor:o.status==="klaar"?C.borderGreen:C.border }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6 }}>
                        <div style={{ fontFamily:"'Cinzel',serif",fontSize:14,color:o.status==="klaar"?C.green:C.goldLight }}>{o.titel}</div>
                        <div style={{ fontSize:11,letterSpacing:1,color:o.status==="klaar"?C.green:C.gold }}>{o.status==="klaar"?"✓ KLAAR":"OPEN"}</div>
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
