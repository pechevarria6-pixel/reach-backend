import { useState, useEffect, useRef } from "react";

const C = {
  // Backgrounds - warm deep noir
  bg: "#0A0805", s1: "#120F09", s2: "#1A1510", s3: "#221C14",
  border: "#2E2618", borderLight: "#3D3220",
  // Brand - warm gold
  accent: "#D4A843", accentHover: "#E0BC68", accentDim: "rgba(212,168,67,0.12)", accentBorder: "rgba(212,168,67,0.3)",
  // Semantic
  green: "#52C97B", greenDim: "rgba(82,201,123,0.1)",
  amber: "#F59E0B", amberDim: "rgba(245,158,11,0.1)",
  red: "#F87171", redDim: "rgba(248,113,113,0.1)",
  blue: "#60A5FA", blueDim: "rgba(96,165,250,0.1)",
  gold: "#D4A843", goldDim: "rgba(212,168,67,0.08)",
  // Text - warm creams
  t1: "#F5EDD8", t2: "#9A8A6A", t3: "#5C4E32", t4: "#3A2E1A",
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
body{background:#050508;display:flex;justify-content:center;min-height:100vh;padding:20px 0 40px;font-family:'Space Grotesk',sans-serif;}
.aw{width:393px;height:852px;background:${C.bg};border-radius:50px;overflow:hidden;position:relative;border:1.5px solid rgba(212,168,67,0.25);box-shadow:0 80px 200px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.04) inset,0 1px 0 rgba(255,255,255,.08) inset,0 0 80px rgba(212,168,67,0.08);display:flex;flex-direction:column;}
.sb{display:flex;justify-content:space-between;align-items:center;padding:14px 28px 0;flex-shrink:0;font-size:12px;font-weight:600;color:${C.t2};letter-spacing:.02em;}
.sb-logo{font-family:'Instrument Serif',serif;font-size:17px;color:${C.t1};letter-spacing:-.02em;}
.ma{flex:1;overflow:hidden;position:relative;}
.sc{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;padding-bottom:90px;}
.sc::-webkit-scrollbar{display:none;}
.nb{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;background:rgba(6,6,16,.95);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-top:1px solid rgba(212,168,67,0.12);padding:10px 0 24px;z-index:100;}
.nb-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:none;border:none;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:10px;font-weight:500;color:${C.t3};transition:color .15s;padding:4px 0;}
.nb-btn.active{color:${C.accent};}
.nb-btn svg{width:22px;height:22px;transition:transform .15s;}
.nb-btn.active svg{transform:translateY(-1px);}
.nb-dot{width:4px;height:4px;border-radius:50%;background:${C.accent};margin:0 auto;opacity:0;transition:opacity .15s;}
.nb-btn.active .nb-dot{opacity:1;}
.pt{font-family:'Instrument Serif',serif;font-size:30px;color:${C.t1};line-height:1.1;}
.sl{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${C.t3};}
.card{background:linear-gradient(145deg,${C.s1},${C.s2});border:1px solid ${C.border};border-radius:22px;overflow:hidden;transition:all .2s;cursor:pointer;}
.card:hover{border-color:rgba(124,110,255,0.3);transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,0.4);}
.card:active{transform:scale(.98);}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
.pill-g{background:${C.greenDim};color:${C.green};}
.pill-a{background:${C.amberDim};color:${C.amber};}
.pill-r{background:${C.redDim};color:${C.red};}
.pill-p{background:${C.accentDim};color:${C.accent};}
.pill-m{background:${C.s3};color:${C.t2};}
.bp{width:100%;padding:16px 20px;background:linear-gradient(135deg,#C49A38,${C.accent});color:white;border:none;border-radius:18px;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;letter-spacing:.01em;box-shadow:0 4px 20px rgba(212,168,67,0.25);}
.bp:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(212,168,67,0.35);}
.bp:active{transform:scale(.98);}
.bp:disabled{opacity:.35;cursor:not-allowed;}
.bs{width:100%;padding:14px 20px;background:${C.s2};color:${C.t1};border:1px solid ${C.border};border-radius:16px;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:500;cursor:pointer;transition:border-color .15s;}
.bs:hover{border-color:${C.borderLight};}
.bsm{padding:7px 14px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:opacity .15s;}
.bsm:hover{opacity:.85;}
.bsm-p{background:${C.accent};color:white;}
.bsm-g{background:${C.s3};color:${C.t2};}
.bsm-r{background:${C.redDim};color:${C.red};}
.bsm-gr{background:${C.greenDim};color:${C.green};}
.inp{width:100%;padding:14px 16px;background:${C.s2};border:1.5px solid ${C.border};border-radius:16px;color:${C.t1};font-family:'Space Grotesk',sans-serif;font-size:14px;outline:none;transition:all .2s;}
.inp:focus{border-color:${C.accent};box-shadow:0 0 0 3px rgba(212,168,67,0.1);background:${C.s1};}
.inp::placeholder{color:${C.t3};}
.ov{position:absolute;inset:0;background:rgba(0,0,0,.72);z-index:200;display:flex;align-items:flex-end;animation:fi .2s ease;}
.sh{width:100%;max-height:90%;background:${C.s1};border-radius:28px 28px 0 0;border-top:1px solid ${C.border};overflow-y:auto;scrollbar-width:none;animation:su .25s cubic-bezier(.32,.72,0,1);padding-bottom:30px;}
.sh::-webkit-scrollbar{display:none;}
.sh-hdl{width:36px;height:4px;border-radius:2px;background:${C.border};margin:12px auto 0;}
.sh-hdr{padding:20px 20px 16px;border-bottom:1px solid ${C.border};display:flex;align-items:center;justify-content:space-between;}
.sh-ttl{font-size:17px;font-weight:600;color:${C.t1};}
.toast{position:absolute;top:70px;left:16px;right:16px;background:${C.green};color:white;border-radius:14px;padding:12px 16px;font-size:13px;font-weight:600;z-index:500;text-align:center;animation:ti .3s ease,to .3s ease 2.2s forwards;}
.ri{display:flex;align-items:center;gap:12px;padding:13px 20px;cursor:pointer;transition:background .1s;}
.ri:hover{background:${C.s2};}
.ri-ic{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
.ri-inf{flex:1;}
.ri-t{font-size:14px;font-weight:500;color:${C.t1};}
.ri-s{font-size:12px;color:${C.t2};margin-top:1px;}
.av-cl{display:flex;}
.av{width:26px;height:26px;border-radius:50%;border:2px solid ${C.bg};margin-left:-6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:white;}
.av:first-child{margin-left:0;}
.av-lg{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;color:white;}
.cb-row{display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer;transition:background .1s;}
.cb-row:hover{background:${C.s2};}
.cb{width:22px;height:22px;border-radius:7px;border:2px solid ${C.border};flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.cb.ck{background:${C.accent};border-color:${C.accent};}
.pb-t{height:3px;background:${C.s3};border-radius:2px;}
.pb-f{height:100%;border-radius:2px;background:${C.accent};transition:width .3s;}
.sd{display:flex;gap:6px;}
.sd-d{height:3px;border-radius:2px;flex:1;background:${C.s3};transition:background .3s;}
.sd-d.active{background:${C.accent};}
.it-item{display:flex;gap:14px;padding:12px 20px;}
.it-time{font-size:11px;color:${C.t2};width:42px;flex-shrink:0;padding-top:2px;text-align:right;}
.it-lc{display:flex;flex-direction:column;align-items:center;width:20px;flex-shrink:0;}
.it-dot{width:10px;height:10px;border-radius:50%;border:2px solid ${C.accent};background:${C.bg};flex-shrink:0;margin-top:3px;}
.it-dot.fi{background:${C.accent};}
.it-cn{flex:1;width:2px;background:${C.border};margin:4px 0;min-height:20px;}
.it-cont{flex:1;}
.it-tt{font-size:14px;font-weight:500;color:${C.t1};}
.it-sb{font-size:12px;color:${C.t2};margin-top:2px;}
.it-cf{font-size:10px;color:${C.green};margin-top:3px;font-weight:500;}
.bk-row{display:flex;justify-content:space-between;align-items:flex-start;padding:11px 20px;border-bottom:1px solid ${C.border};}
.bk-k{font-size:13px;color:${C.t2};}
.bk-v{font-size:13px;color:${C.t1};font-weight:500;text-align:right;max-width:200px;}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes su{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes ti{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
@keyframes to{to{opacity:0;transform:translateY(-10px)}}
`;

const ALL_CONTACTS = [];

const INIT_GROUPS = [];

const EXPS = [
  {id:"e1",title:"Northern Lights, Iceland",sub:"7 nights · Adventure",price:"$2,800",emoji:"🌌",bg:"linear-gradient(145deg,#1a1060,#6C63FF)",tags:["Trips"]},
  {id:"e2",title:"Tulum Food & Culture",sub:"5 nights · Cultural",price:"$1,900",emoji:"🌮",bg:"linear-gradient(145deg,#064E3B,#10B981)",tags:["Trips"]},
  {id:"e3",title:"Beyoncé · MSG",sub:"Concert · Aug 19",price:"$340",emoji:"🎤",bg:"linear-gradient(145deg,#78350F,#F59E0B)",tags:["Concerts"]},
  {id:"e4",title:"Montauk Beach House",sub:"Weekend · Aug 2–4",price:"$420/night",emoji:"🌊",bg:"linear-gradient(145deg,#1E3A5F,#3B82F6)",tags:["Weekends"]},
  {id:"e5",title:"New Orleans Jazz Fest",sub:"Festival · May 2027",price:"$180/day",emoji:"🎷",bg:"linear-gradient(145deg,#4C1D95,#EC4899)",tags:["Festivals"]},
  {id:"e6",title:"Nobu Malibu",sub:"Restaurant · Dinner for groups",price:"$160/pp",emoji:"🍣",bg:"linear-gradient(145deg,#1F2937,#6B7280)",tags:["Restaurants"]},
];

// Icons
const Ic = {
  Home:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Compass:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  Users:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  User:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  ChevL:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevR:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>,
  X:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Check:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg>,
  Trash:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  Edit:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Plus:()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
};

function Av({u,lg}){return <div className={lg?"av-lg":"av"} style={{background:u.color}}>{u.initials}</div>;}
function AvCluster({ids,um,max=4}){const shown=ids.slice(0,max);const extra=ids.length-max;return <div className="av-cl">{shown.map(id=>{const u=um[id];return u?<div key={id} className="av" style={{background:u.color}}>{u.initials}</div>:null;})}{extra>0&&<div className="av" style={{background:C.s3,color:C.t2}}>+{extra}</div>}</div>;}
function Toast({msg,onDone}){useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[]);return <div className="toast">✓ {msg}</div>;}

// ─── HOME ────────────────────────────────────────────────────────────────────
function HomeScreen({groups,um,push,toast,loading,user,setTab}){
  const [nearbyEvents,setNearbyEvents]=useState([
    {emoji:"🎵",title:"SF Jazz Festival",meta:"Sat Jun 28 · Davies Hall",dist:"0.4 mi"},
    {emoji:"🍕",title:"SF Street Food Fest",meta:"Sun Jun 29 · Civic Center",dist:"0.9 mi"},
    {emoji:"🎸",title:"Outside Lands 2026",meta:"Aug 8–10 · Golden Gate Park",dist:"2.1 mi"},
  ]);
  useEffect(()=>{
    try{
      if(typeof navigator==="undefined"||!navigator.geolocation)return;
      navigator.geolocation.getCurrentPosition(
        async function(pos){
          try{
            const lat=pos.coords.latitude;
            const lng=pos.coords.longitude;
            const res=await fetch("/api/nearby?lat="+lat+"&lng="+lng);
            if(res.ok){const data=await res.json();if(data.events?.length)setNearbyEvents(data.events);}
          }catch(e){}
        },
        function(err){ /* location denied - use defaults */ },
        {timeout:8000,enableHighAccuracy:false,maximumAge:300000}
      );
    }catch(e){}
  },[]);
  const allPlans=groups.flatMap(g=>g.plans.map(p=>({...p,group:g})));
  const upcoming=allPlans.filter(p=>p.status==="booked"||p.status==="voting"||p.status==="approved");
  const actions=[
    ...allPlans.filter(p=>p.status==="voting").map(p=>({type:"vote",text:`Vote: ${p.options.join(" vs ")}`,sub:p.group.name,plan:p})),
  ];
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"14px 20px 12px"}}>
        <div style={{fontSize:12,color:C.t3,marginBottom:3,textTransform:"uppercase",letterSpacing:".1em",fontWeight:500}}>
          {new Date().getHours()<12?"Good morning":new Date().getHours()<17?"Good afternoon":"Good evening"}
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:34,color:C.t1,lineHeight:1.1}}>
          Hey {user?.firstName||user?.name?.split(" ")[0]||"there"} 👋
        </div>
      </div>

      {/* Draft resume banner */}
      {(()=>{
        try{
          if(typeof window==="undefined")return null;
          const d=window.localStorage.getItem("reach_plan_draft");
          if(!d)return null;
          const dr=JSON.parse(d);
          if(!dr?.planType&&!dr?.gid)return null;
          const typeLabel=dr.planType==="restaurant"?"dinner out":dr.planType==="concert"?"concert night":dr.planType==="weekend"?"weekend away":"trip";
          const totalSteps=dr.planType==="restaurant"||dr.planType==="concert"?4:dr.planType==="weekend"?5:6;
          return(
            <div style={{margin:"0 20px 14px",background:`linear-gradient(135deg,${C.accentDim},rgba(108,99,255,.05))`,border:`1px solid ${C.accentBorder}`,borderRadius:16,padding:"12px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>push("createPlan",{})}>
              <div style={{fontSize:26,flexShrink:0}}>{dr.planType==="restaurant"?"🍽️":dr.planType==="concert"?"🎵":dr.planType==="weekend"?"🏡":"✈️"}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Resume your draft</div>
                <div style={{fontSize:12,color:C.t2,marginTop:2}}>
                  {dr.planName||`New ${typeLabel}`} · Step {(dr.step||0)+1} of {totalSteps}
                </div>
                <div style={{marginTop:6,display:"flex",gap:3}}>
                  {Array.from({length:totalSteps}).map((_,i)=>(
                    <div key={i} style={{flex:1,height:2,borderRadius:1,background:i<=(dr.step||0)?C.accent:C.s3}}/>
                  ))}
                </div>
              </div>
              <div style={{fontSize:18,color:C.accent,fontWeight:600}}>→</div>
            </div>
          );
        }catch{return null;}
      })()}

      {actions.length>0&&(
        <div style={{margin:"0 20px 18px",background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:C.accent}}/>
            <span style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:C.accent}}>{actions.length} actions needed</span>
          </div>
          {actions.map((a,i)=>(
            <div key={i} onClick={()=>{if(a.plan&&a.plan.id&&a.plan.group?.id)push("planDetail",{planId:a.plan.id,groupId:a.plan.group.id});}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderTop:i?"1px solid "+C.accentBorder:"none",cursor:"pointer"}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{a.text}</div>
                <div style={{fontSize:11,color:C.t2,marginTop:2}}>{a.sub}</div>
              </div>
              <button className="bsm bsm-p" onClick={e=>{e.stopPropagation();a.plan&&push("planDetail",{planId:a.plan.id,groupId:a.plan.group?.id});}}>{a.type==="vote"?"Vote →":a.type==="pay"?"Pay →":"RSVP →"}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 20px 10px"}}>
        <span className="sl">Upcoming</span>
        <span style={{fontSize:12,color:C.accent,cursor:"pointer"}} onClick={()=>setTab("groups")}>See all →</span>
      </div>
      <div style={{display:"flex",gap:12,padding:"0 20px 18px",overflowX:"auto",scrollbarWidth:"none"}}>
        {upcoming.map(plan=>(
          <div key={plan.id} onClick={()=>push("planDetail",{planId:plan.id,groupId:plan.group.id})}
            style={{minWidth:200,background:"linear-gradient(145deg,#1a1060,#6C63FF)",borderRadius:20,border:`1px solid ${C.border}`,cursor:"pointer",flexShrink:0,transition:"transform .15s"}}>
            <div style={{padding:16}}>
              <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`} style={{marginBottom:10,display:"inline-flex"}}>
                {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"⏳ Voting":"📋 Planning"}
              </span>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:"white",marginBottom:4}}>{plan.title}</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)",marginBottom:10}}>{plan.dates} · {plan.group.name}</div>
              <AvCluster ids={plan.participants} um={um} max={4}/>
            </div>
          </div>
        ))}
        <div onClick={()=>push("createPlan",{})} style={{minWidth:130,background:"transparent",border:`2px dashed ${C.border}`,borderRadius:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,padding:20,cursor:"pointer",flexShrink:0}}>
          <div style={{fontSize:24,color:C.t3}}>＋</div>
          <div style={{fontSize:12,color:C.t2,fontWeight:500,textAlign:"center"}}>New plan</div>
        </div>
      </div>
      <div style={{padding:"0 20px 10px"}}><span className="sl">Relationship insights</span></div>
      {(groups.length>0?[
        {emoji:"✈️",text:groups[0].name+" · "+(groups[0].plans?.length||0)+" plan"+(((groups[0].plans?.length||0)!==1)?"s":""),cta:"Open →",action:()=>push("groupDetail",{groupId:groups[0].id})},
        groups.length>1?{emoji:"👥",text:"You're in "+groups.length+" groups.",cta:"See all →",action:()=>setTab("groups")}:{emoji:"➕",text:"Invite friends to plan together.",cta:"Create a group →",action:()=>push("createGroup")},
      ]:[
        {emoji:"👋",text:"Welcome! Create your first group to start planning.",cta:"Get started →",action:()=>push("createGroup")},
      ]).filter(Boolean).map((ins,i)=>(
        <div key={i} onClick={ins.action} style={{margin:"0 20px 10px",background:C.s1,border:"1px solid "+C.border,borderRadius:16,padding:14,display:"flex",gap:12,cursor:"pointer"}}>
          <span style={{fontSize:24}}>{ins.emoji}</span>
          <div>
            <div style={{fontSize:13,color:C.t1,lineHeight:1.5}}>{ins.text}</div>
            <div style={{fontSize:12,color:C.accent,marginTop:4,fontWeight:500}}>{ins.cta}</div>
          </div>
        </div>
      ))}
      <div style={{padding:"14px 20px 6px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span className="sl">Near you</span>
        {user?.location&&<span style={{fontSize:11,color:C.t3}}>📍 {user.location}</span>}
      </div>
      {nearbyEvents.map((n,i)=>(
        <div key={i} style={{margin:"0 20px 8px",background:C.s1,border:`1px solid ${C.border}`,borderRadius:14,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
          <span style={{fontSize:26,flexShrink:0}}>{n.emoji}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:500,color:C.t1}}>{n.title}</div>
            <div style={{fontSize:11,color:C.t2,marginTop:2}}>{n.meta}</div>
          </div>
          <div style={{fontSize:11,color:C.t3}}>{n.dist}</div>
        </div>
      ))}
      <div style={{height:20}}/>
    </div>
  );
}

// ─── DISCOVER ────────────────────────────────────────────────────────────────
function DiscoverScreen({push,groups,toast,user,userLocation}){
  const [filter,setFilter]=useState("All");
  const [localRecs,setLocalRecs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const filters=["All","Nearby","Concerts","Restaurants","Weekends","Trips","Festivals"];

  useEffect(()=>{
    if(loaded)return;
    // Show cached results instantly, refresh in background
    const hasCached=loadFromCache();
    if(!hasCached){
      loadLocalRecs();
    } else {
      // Refresh in background after showing cached
      setTimeout(loadLocalRecs, 100);
    }
  },[]);
  
  // Reload when location becomes available
  useEffect(()=>{
    if(userLocation&&!loaded)loadLocalRecs();
    if(userLocation&&loaded){
      // Location just became available, refresh
      setLoaded(false);
      setLocalRecs([]);
      loadLocalRecs();
    }
  },[userLocation?.lat]);

  const loadLocalRecs=async()=>{
    setLoading(true);
    try{
      const lat=userLocation?.lat;
      const lng=userLocation?.lng;
      const city=encodeURIComponent(userLocation?.city||userLocation?.formatted||"");
      let url="/api/nearby";
      if(lat&&lng)url+=`?lat=${lat}&lng=${lng}&city=${city}`;
      else if(city)url+=`?city=${city}`;

      const res=await fetch(url);
      if(res.ok){
        const data=await res.json();
        if(data.events?.length){
          setLocalRecs(data.events);
          // Cache in sessionStorage so reload is instant
          try{sessionStorage.setItem("reach_nearby",JSON.stringify({events:data.events,city:data.city,ts:Date.now()}));}catch(e){}
        }
      }
    }catch(e){}
    setLoaded(true);
    setLoading(false);
  };

  // Load from cache immediately, then refresh in background
  const loadFromCache=()=>{
    try{
      const cached=sessionStorage.getItem("reach_nearby");
      if(!cached)return false;
      const {events,ts}=JSON.parse(cached);
      // Use cache if less than 2 hours old
      if(Date.now()-ts<7200000&&events?.length){
        setLocalRecs(events);
        setLoaded(true);
        return true;
      }
    }catch(e){}
    return false;
  };

  // Combine AI local recs with curated experiences
  const allItems=[
    ...localRecs.map(e=>({
      id:"local_"+e.id,
      title:e.title,
      sub:e.meta,
      emoji:e.emoji,
      price:e.price||"Free",
      dist:e.dist,
      tags:["Nearby"],
      bg:"linear-gradient(135deg,#1a1a2e,#16213e)",
      isLocal:true,
    })),
    ...EXPS,
  ];

  const shown=filter==="All"?allItems
    :filter==="Nearby"?allItems.filter(e=>e.isLocal)
    :allItems.filter(e=>e.tags?.includes(filter));

  const city=userLocation?.city||userLocation?.formatted;

  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 10px"}}>
        <div className="pt">Discover</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>
          {city?"Based on your location in "+city:"Curated for you"}
        </div>
        {!userLocation&&(
          <div style={{fontSize:12,color:C.accent,marginTop:4,cursor:"pointer"}}
            onClick={()=>toast("Enable location in your browser for local picks")}>
            📍 Enable location for local recommendations
          </div>
        )}
      </div>

      {/* Filter pills */}
      <div style={{display:"flex",gap:8,padding:"0 20px 14px",overflowX:"auto",scrollbarWidth:"none"}}>
        {filters.map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            style={{padding:"6px 14px",borderRadius:20,
              border:"1px solid "+(filter===f?C.accent:C.border),
              background:filter===f?C.accentDim:C.s1,
              color:filter===f?C.accent:C.t2,
              fontSize:12,fontWeight:600,cursor:"pointer",
              whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif",flexShrink:0}}>
            {f==="Nearby"&&userLocation?"📍 "+f:f}
          </button>
        ))}
      </div>

      {/* Nearby events strip (when location available) */}
      {userLocation&&localRecs.length>0&&filter==="All"&&(
        <div style={{marginBottom:16}}>
          <div style={{padding:"0 20px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:600,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>
              📍 Near you in {city}
            </span>
            <button onClick={()=>setFilter("Nearby")}
              style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
              See all →
            </button>
          </div>
          <div style={{display:"flex",gap:12,padding:"0 20px",overflowX:"auto",scrollbarWidth:"none",paddingBottom:4}}>
            {localRecs.slice(0,5).map((n,i)=>(
              <div key={i} style={{minWidth:160,background:C.s2,border:"1px solid "+C.border,
                borderRadius:16,padding:14,flexShrink:0,cursor:"pointer"}}
                onClick={()=>push("expDetail",{exp:{
                  id:"local_"+n.id,title:n.title,sub:n.meta,emoji:n.emoji,
                  price:n.price||"Free",tags:["Nearby"],
                  bg:"linear-gradient(135deg,#1a1a2e,#16213e)",
                },groups})}>
                <div style={{fontSize:28,marginBottom:6}}>{n.emoji}</div>
                <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:2,lineHeight:1.3}}>{n.title}</div>
                <div style={{fontSize:11,color:C.t2,lineHeight:1.4}}>{n.meta}</div>
                {n.dist&&<div style={{fontSize:11,color:C.accent,marginTop:4}}>📍 {n.dist}</div>}
                {n.price&&<div style={{fontSize:12,fontWeight:600,color:C.t1,marginTop:4}}>{n.price}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading&&(
        <div style={{textAlign:"center",padding:"20px",color:C.t3,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <div style={{width:16,height:16,border:"2px solid "+C.accent,borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
          Finding things near you…
        </div>
      )}

      {/* Main cards */}
      {shown.map(exp=>(
        <div key={exp.id} style={{margin:"0 20px 14px",borderRadius:20,overflow:"hidden",
          border:"1px solid "+C.border,cursor:"pointer"}}
          onClick={()=>push("expDetail",{exp,groups})}>
          <div style={{height:175,background:exp.bg,position:"relative"}}>
            <div style={{position:"absolute",inset:0,
              background:"linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.85))",
              display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:16}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:"white",marginBottom:3}}>
                {exp.title}
              </div>
              <div style={{fontSize:12,color:"rgba(255,255,255,.65)"}}>{exp.sub}</div>
            </div>
            <div style={{position:"absolute",top:12,right:14,fontSize:34}}>{exp.emoji}</div>
            {exp.isLocal&&exp.dist&&(
              <div style={{position:"absolute",top:12,left:14,background:"rgba(0,0,0,.6)",
                borderRadius:20,padding:"3px 10px",fontSize:11,color:"white"}}>
                📍 {exp.dist}
              </div>
            )}
          </div>
          <div style={{background:C.s1,padding:"12px 16px",display:"flex",
            justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>
                {exp.price}
              </div>
              <div style={{fontSize:11,color:C.t2}}>
                {exp.isLocal?"Near you":"per person, all-in"}
              </div>
            </div>
            <button className="bsm bsm-p"
              onClick={e=>{e.stopPropagation();toast(exp.title+" shared");}}>
              Share with group
            </button>
          </div>
        </div>
      ))}

      {shown.length===0&&!loading&&(
        <div style={{textAlign:"center",padding:"40px 20px",color:C.t3,fontSize:14}}>
          {filter==="Nearby"?"No local events found. Try enabling location access.":"Nothing here yet."}
        </div>
      )}

      <div style={{height:20}}/>
    </div>
  );
}

// ─── EXPERIENCE DETAIL ───────────────────────────────────────────────────────
function ExpDetailScreen({onBack,exp,groups,push,toast,updateGroup,savePlanToServer}){
  const [gpicker,setGpicker]=useState(false);
  const [planPicker,setPlanPicker]=useState(false);
  const [saving,setSaving]=useState(false);
  const [quizDone,setQuizDone]=useState(false);
  const [booking,setBooking]=useState(false);
  const [bookStep,setBookStep]=useState(0); // 0=details 1=confirm 2=done
  const [bookDate,setBookDate]=useState("");
  const [bookTime,setBookTime]=useState("");
  const [bookGuests,setBookGuests]=useState("2");
  const [bookNotes,setBookNotes]=useState("");

  // Detect what type of experience this is
  const isLocal=exp.isLocal||exp.tags?.includes("Nearby");
  const isRestaurant=exp.category==="Restaurant"||exp.title?.toLowerCase().includes("restaurant")||exp.title?.toLowerCase().includes("dinner")||exp.title?.toLowerCase().includes("brunch");
  const isConcert=exp.category==="Concert"||exp.category==="Music"||exp.tags?.includes("Concerts");
  const isBar=exp.category==="Bar"||exp.title?.toLowerCase().includes("bar")||exp.title?.toLowerCase().includes("rooftop");

  const getType=()=>{
    if(isRestaurant)return"restaurant";
    if(isConcert)return"concert";
    return"restaurant"; // default for local experiences
  };

  const getIncludes=()=>{
    if(isRestaurant)return["🍽️ Dinner & drinks","👥 Group reservation","📍 "+exp.sub?.split("·").pop()?.trim()];
    if(isConcert)return["🎵 Live music","🎫 Tickets","📍 "+exp.sub?.split("·").pop()?.trim()];
    if(isBar)return["🍹 Drinks & vibes","📍 "+exp.sub?.split("·").pop()?.trim(),"🌙 Evening out"];
    return["🎯 Full experience","👥 Group booking","📍 "+exp.sub?.split("·").pop()?.trim()];
  };

  // Add this experience directly to a group as a plan
  const addToGroup=async(group)=>{
    setSaving(true);
    const today=new Date();
    const eventDateStr=exp.meta?.split("·")[0]?.trim()||"";
    const np={
      id:"p"+Date.now(),
      title:exp.title,
      status:"planning",
      dates:eventDateStr||(bookDate||today.toISOString().split("T")[0])+(bookTime?" at "+bookTime:""),
      budget:parseInt((exp.price||"0").replace(/[^0-9]/g,""))||0,
      type:getType(),
      participants:group.memberIds||[],
      itinerary:[{
        time:exp.meta?.split("·")[0]?.trim()||"",
        title:exp.title,
        sub:exp.sub||"",
        type:isRestaurant?"restaurant":isConcert?"activity":"activity",
        conf:null,filled:false,
      }],
      votes:{},options:[],
      fromDiscover:true,
      expData:exp,
    };
    updateGroup(group.id,g=>({...g,plans:[...g.plans,np],lastActivity:"Added: "+exp.title}));
    if(savePlanToServer)savePlanToServer(group.id,np);
    setSaving(false);
    setPlanPicker(false);
    toast(exp.title+" added to "+group.name+" 🎉");
    push("planDetail",{planId:np.id,groupId:group.id});
  };

  return(
    <div className="sc" style={{paddingBottom:0}}>
      {/* Header */}
      <div style={{height:200,background:exp.bg||"linear-gradient(135deg,#1a1060,#6C63FF)",position:"relative",flexShrink:0}}>
        <button onClick={onBack} style={{position:"absolute",top:16,left:16,width:36,height:36,borderRadius:"50%",background:"rgba(0,0,0,.4)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"white"}}><Ic.ChevL/></button>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.9))",display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:20}}>
          <div style={{fontSize:40,marginBottom:8}}>{exp.emoji||"🎯"}</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:"white",lineHeight:1.2}}>{exp.title}</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginTop:4}}>{exp.sub}</div>
        </div>
        {exp.dist&&(
          <div style={{position:"absolute",top:16,right:16,background:"rgba(0,0,0,.5)",borderRadius:20,padding:"4px 12px",fontSize:12,color:"white"}}>
            📍 {exp.dist}
          </div>
        )}
      </div>

      <div style={{padding:20,overflowY:"auto",flex:1}}>
        {/* Price + type */}
        <div style={{display:"flex",gap:10,marginBottom:20}}>
          <div style={{flex:1,background:C.s2,borderRadius:14,padding:14,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,color:C.t3,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Price</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{exp.price||"—"}</div>
            <div style={{fontSize:11,color:C.t2}}>per person</div>
          </div>
          <div style={{flex:1,background:C.s2,borderRadius:14,padding:14,border:"1px solid "+C.border}}>
            <div style={{fontSize:11,color:C.t3,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Type</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{exp.category||exp.tags?.[0]||"Experience"}</div>
            <div style={{fontSize:11,color:C.t2}}>{exp.sub?.split("·")[0]?.trim()}</div>
          </div>
        </div>

        {/* What to expect */}
        <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:10}}>What to expect</div>
        {getIncludes().map((it,i)=>(
          <div key={i} style={{fontSize:13,color:C.t2,padding:"6px 0",borderBottom:i<getIncludes().length-1?"1px solid "+C.border:"none"}}>
            {it}
          </div>
        ))}

        <div style={{height:1,background:C.border,margin:"20px 0"}}/>

        {/* Book Now — direct action */}
        <button className="bp" style={{marginBottom:10,width:"100%",background:"linear-gradient(135deg,#C49A38,"+C.accent+")"}}
          onClick={()=>setBooking(true)}>
          🎯 Book Now
        </button>
        <button className="bs" style={{marginBottom:10,width:"100%"}}
          onClick={()=>setPlanPicker(true)}>
          ➕ Add to a Group Plan
        </button>
        <button style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",width:"100%",padding:"8px 0"}}
          onClick={()=>setGpicker(true)}>
          💬 Share with a Group
        </button>
      </div>

      {/* Add to group picker */}
      {planPicker&&(
        <div className="ov" onClick={()=>setPlanPicker(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div className="sh-hdr">
              <span className="sh-ttl">Add to which group?</span>
              <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>setPlanPicker(false)}><Ic.X/></button>
            </div>
            <div style={{padding:"0 0 12px",fontSize:13,color:C.t2}}>
              This creates a plan in the group so everyone can see it and RSVP.
            </div>
            {groups.length===0&&(
              <div style={{textAlign:"center",padding:"20px 0",color:C.t3,fontSize:13}}>
                No groups yet. Create a group first.
              </div>
            )}
            {groups.map(g=>(
              <div key={g.id} className="ri" onClick={()=>!saving&&addToGroup(g)}
                style={{opacity:saving?.6:1,cursor:saving?"not-allowed":"pointer"}}>
                <div className="ri-ic" style={{background:C.s3,fontSize:20}}>{g.emoji}</div>
                <div className="ri-inf">
                  <div className="ri-t">{g.name}</div>
                  <div className="ri-s">{g.memberIds?.length||0} members</div>
                </div>
                {saving?<div style={{fontSize:12,color:C.t3}}>Adding…</div>:<Ic.ChevR/>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Book Now sheet */}
      {booking&&(
        <div className="ov" onClick={()=>{setBooking(false);setBookStep(0);}}>
          <div className="sh" onClick={e=>e.stopPropagation()} style={{maxHeight:"85vh",overflowY:"auto"}}>
            <div className="sh-hdl"/>
            {bookStep===0&&(
              <>
                <div className="sh-hdr">
                  <span className="sh-ttl">Book {exp.title}</span>
                  <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>{setBooking(false);setBookStep(0);}}><Ic.X/></button>
                </div>
                <div style={{padding:"0 0 8px"}}>
                  <div style={{background:C.accentDim,border:"1px solid "+C.accentBorder,borderRadius:14,padding:14,marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:28}}>{exp.emoji||"🎯"}</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{exp.title}</div>
                      <div style={{fontSize:12,color:C.t2}}>{exp.sub}</div>
                      <div style={{fontSize:13,color:C.accent,fontWeight:600,marginTop:2}}>{exp.price} per person</div>
                    </div>
                  </div>

                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Date</div>
                    <input type="date" className="inp" value={bookDate}
                      min={new Date().toISOString().split("T")[0]}
                      onChange={e=>setBookDate(e.target.value)} style={{color:C.t1}}/>
                  </div>

                  {(isRestaurant||isBar)&&(
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Time</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {["6:00 PM","6:30 PM","7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM"].map(t=>(
                          <button key={t} onClick={()=>setBookTime(t)}
                            style={{padding:"8px 14px",borderRadius:20,border:"1px solid "+(bookTime===t?C.accent:C.border),
                              background:bookTime===t?C.accentDim:C.s2,color:bookTime===t?C.accent:C.t2,
                              fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Party size</div>
                    <div style={{display:"flex",gap:8}}>
                      {["1","2","3","4","5","6","7","8+"].map(n=>(
                        <button key={n} onClick={()=>setBookGuests(n)}
                          style={{width:40,height:40,borderRadius:10,border:"1px solid "+(bookGuests===n?C.accent:C.border),
                            background:bookGuests===n?C.accentDim:C.s2,color:bookGuests===n?C.accent:C.t2,
                            fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Special requests (optional)</div>
                    <input className="inp" value={bookNotes} onChange={e=>setBookNotes(e.target.value)}
                      placeholder="Allergies, celebrations, seating preferences..."/>
                  </div>

                  <button className="bp" style={{width:"100%",marginBottom:8}}
                    disabled={!bookDate||(isRestaurant&&!bookTime)}
                    onClick={()=>setBookStep(1)}>
                    Continue →
                  </button>
                </div>
              </>
            )}

            {bookStep===1&&(
              <>
                <div className="sh-hdr">
                  <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2,fontSize:13,fontFamily:"'Space Grotesk',sans-serif"}} onClick={()=>setBookStep(0)}>← Back</button>
                  <span className="sh-ttl">Confirm booking</span>
                  <div style={{width:48}}/>
                </div>
                <div style={{padding:"0 0 8px"}}>
                  {/* Booking summary */}
                  <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:16,marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:12}}>{exp.title}</div>
                    {[
                      {l:"📅 Date",v:bookDate?new Date(bookDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}):"—"},
                      bookTime?{l:"🕐 Time",v:bookTime}:null,
                      {l:"👥 Party",v:bookGuests+(bookGuests==="8+"?" people":" people")},
                      {l:"💰 Total est.",v:exp.price&&bookGuests?((parseInt(exp.price.replace(/[^0-9]/g,""))||0)*(parseInt(bookGuests)||2))>0?"$"+((parseInt(exp.price.replace(/[^0-9]/g,""))||0)*(parseInt(bookGuests)||2))+" est.":"—":"—"},
                      bookNotes?{l:"📝 Notes",v:bookNotes}:null,
                    ].filter(Boolean).map((row,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:i?"1px solid "+C.border:"none"}}>
                        <div style={{fontSize:13,color:C.t2}}>{row.l}</div>
                        <div style={{fontSize:13,color:C.t1,fontWeight:500,textAlign:"right",maxWidth:"55%"}}>{row.v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{background:"rgba(108,99,255,.08)",border:"1px solid "+C.accentBorder,borderRadius:12,padding:12,marginBottom:16,fontSize:12,color:C.t2,lineHeight:1.6}}>
                    💡 This sends a booking request to {exp.title}. They'll confirm via the app within 24 hours. No charge until confirmed.
                  </div>

                  <button className="bp" style={{width:"100%",marginBottom:8}}
                    onClick={()=>{
                      // Save as confirmed plan in group
                      setBookStep(2);
                      toast("Booking request sent to "+exp.title+" ✓");
                    }}>
                    ✓ Confirm Booking Request
                  </button>
                  <button className="bs" style={{width:"100%"}} onClick={()=>setBookStep(0)}>Edit details</button>
                </div>
              </>
            )}

            {bookStep===2&&(
              <div style={{padding:"20px 0 30px",textAlign:"center"}}>
                <div style={{fontSize:60,marginBottom:16}}>🎉</div>
                <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,marginBottom:8}}>Booking request sent!</div>
                <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:24}}>
                  Your request for {exp.title} on {bookDate} for {bookGuests} people has been sent. You'll get a confirmation notification within 24 hours.
                </div>
                <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:14,marginBottom:20,textAlign:"left"}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>What happens next</div>
                  {["📱 Venue confirms within 24 hrs","💳 Card charged only on confirmation","📅 Added to your calendar","👥 Group notified automatically"].map((s,i)=>(
                    <div key={i} style={{fontSize:13,color:C.t2,padding:"4px 0"}}>{s}</div>
                  ))}
                </div>
                <button className="bp" style={{width:"100%"}} onClick={()=>{setBooking(false);setBookStep(0);onBack();}}>
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Share picker */}
      {gpicker&&(
        <div className="ov" onClick={()=>setGpicker(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div className="sh-hdr">
              <span className="sh-ttl">Share with group</span>
              <button style={{background:"none",border:"none",cursor:"pointer",color:C.t2}} onClick={()=>setGpicker(false)}><Ic.X/></button>
            </div>
            {groups.map(g=>(
              <div key={g.id} className="ri" onClick={()=>{setGpicker(false);toast("Shared with "+g.name);}}>
                <div className="ri-ic" style={{background:C.s3}}>{g.emoji}</div>
                <div className="ri-inf"><div className="ri-t">{g.name}</div><div className="ri-s">{g.memberIds?.length||0} members</div></div>
                <Ic.ChevR/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GROUPS LIST ─────────────────────────────────────────────────────────────
function GroupsScreen({groups,um,push}){
  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div><div className="pt">Groups</div><div style={{fontSize:13,color:C.t2,marginTop:2}}>Your planning circles</div></div>
        <button className="bsm bsm-p" onClick={()=>push("createGroup")}>+ New</button>
      </div>
      {groups.map(g=>{
        const active=g.plans.filter(p=>p.status!=="completed");
        return(
          <div key={g.id} className="card" style={{margin:"0 20px 12px",cursor:"pointer"}} onClick={()=>push("groupDetail",{groupId:g.id})}>
            <div style={{padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontSize:28}}>{g.emoji}</div>
                  <div>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{g.name}</div>
                    <div style={{fontSize:12,color:C.t2}}>{g.memberIds.length} members</div>
                  </div>
                </div>
                <span className="pill pill-g">💰 ${g.wallet.toLocaleString()}</span>
              </div>
              <AvCluster ids={g.memberIds} um={um} max={5}/>
              <div style={{height:1,background:C.border,margin:"12px 0"}}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:12,color:C.t2}}>{g.lastActivity}</div>
                {active.length>0&&<span className="pill pill-p">{active.length} active</span>}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{height:20}}/>
    </div>
  );
}

// ─── GROUP DETAIL ────────────────────────────────────────────────────────────
function GroupDetailScreen({onBack,groupId,groups,um,updateGroup,push,toast,setGroups,refreshGroup}){
  const group=groups.find(g=>g.id===groupId);
  const [tab,setTab]=useState("plans");
  const [refreshing,setRefreshing]=useState(false);

  useEffect(()=>{
    if(!groupId||!refreshGroup)return;
    setRefreshing(true);
    refreshGroup(groupId).finally(()=>setRefreshing(false));
  },[groupId]);

  if(!group)return null;
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 0"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:12,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Groups</button>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:32,marginBottom:4}}>{group.emoji}</div>
            <div className="pt">{group.name}</div>
            <div style={{fontSize:13,color:C.t2,marginTop:2}}>{group.memberIds.length} members · ${group.wallet.toLocaleString()} wallet</div>
          </div>
          <button className="bsm bsm-g" onClick={()=>push("editGroup",{groupId})}>Edit</button>
        </div>
        <div style={{display:"flex",gap:0,marginTop:16,borderBottom:`1px solid ${C.border}`}}>
          {["plans","members","wallet"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px 0",background:"none",border:"none",borderBottom:`2px solid ${tab===t?C.accent:"transparent"}`,color:tab===t?C.accent:C.t2,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",textTransform:"capitalize",transition:"all .15s"}}>{t}</button>
          ))}
        </div>
      </div>
      {tab==="plans"&&(
        <div style={{padding:"14px 0"}}>
          {group.plans.length===0&&(
            <div style={{padding:"40px 20px",textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:12}}>🗺️</div>
              <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>No plans yet</div>
              <div style={{fontSize:13,color:C.t2,marginBottom:20}}>Start planning your first experience together</div>
              <button className="bp" onClick={()=>push("groupTrip",{groupId})}>✨ Plan a Trip Together</button>
              <button style={{background:"none",border:"none",color:C.t2,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",marginTop:10,padding:"8px 0"}} onClick={()=>push("createPlan",{defaultGroupId:groupId})}>+ Add plan manually</button>
            </div>
          )}
          {group.plans.map(plan=>(
            <div key={plan.id} className="card" style={{margin:"0 20px 12px"}} onClick={()=>push("planDetail",{planId:plan.id,groupId})}>
              <div style={{padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{plan.title}</div>
                  <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`}>
                    {plan.status==="booked"?"✓ Booked":plan.status==="voting"?"Voting":plan.status==="approved"?"Approved":"Planning"}
                  </span>
                </div>
                <div style={{fontSize:13,color:C.t2,marginBottom:10}}>{plan.dates} · ${plan.budget}/person</div>
                {plan.status==="voting"&&plan.options.length>0&&(
                  <div style={{background:C.s2,borderRadius:12,padding:10,marginBottom:10}}>
                    <div style={{fontSize:11,color:C.t3,marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>Vote in progress</div>
                    {plan.options.map(opt=>(
                      <div key={opt} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                        <div style={{fontSize:12,color:C.t1,width:60}}>{opt}</div>
                        <div style={{flex:1,height:5,background:C.s3,borderRadius:3,overflow:"hidden"}}>
                          <div style={{height:"100%",background:C.accent,width:`${((plan.votes[opt]||0)/group.memberIds.length)*100}%`,borderRadius:3}}/>
                        </div>
                        <div style={{fontSize:11,color:C.t2}}>{plan.votes[opt]||0}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <AvCluster ids={plan.participants} um={um} max={4}/>
                  <div style={{fontSize:12,color:C.accent,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>View <span style={{fontSize:16}}>→</span></div>
                </div>
              </div>
            </div>
          ))}
          <div style={{padding:"4px 20px 20px"}}>
            <button className="bs" onClick={()=>push("createPlan",{defaultGroupId:groupId})}>+ Add plan manually</button>
          </div>
        </div>
      )}
      {tab==="members"&&(
        <div style={{padding:"14px 0"}}>
          <div style={{padding:"0 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span className="sl">{group.memberIds.length} Members</span>
            <button className="bsm bsm-p" onClick={()=>push("editGroup",{groupId})}>Add Member</button>
          </div>
          {group.memberIds.map(uid=>{
            const u=um[uid];if(!u)return null;
            return(
              <div key={uid} className="ri">
                <Av u={u} lg/>
                <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
                <button className="bsm bsm-r" onClick={()=>{updateGroup(groupId,g=>({...g,memberIds:g.memberIds.filter(id=>id!==uid)}));toast(`${u.name} removed`);}}>Remove</button>
              </div>
            );
          })}
          <div style={{padding:"12px 20px"}}><button className="bs" onClick={()=>push("editGroup",{groupId})}>+ Invite Someone</button></div>
        </div>
      )}
      {tab==="wallet"&&(
        <div style={{padding:"18px 20px"}}>
          <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:20,marginBottom:18,textAlign:"center"}}>
            <div style={{fontSize:12,color:C.accent,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Group Wallet</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:44,color:C.t1}}>${group.wallet.toLocaleString()}</div>
            <div style={{fontSize:12,color:C.t2,marginTop:4}}>Shared · {group.memberIds.length} members</div>
          </div>
          <div style={{display:"flex",gap:10,marginBottom:18}}>
            <button className="bsm bsm-p" style={{flex:1,padding:"12px 0"}} onClick={()=>toast("Funds added")}>Add funds</button>
            <button className="bsm bsm-g" style={{flex:1,padding:"12px 0"}} onClick={()=>toast("Request sent")}>Request split</button>
          </div>
          <div className="sl" style={{marginBottom:12}}>Recent transactions</div>
          {[].map((tx,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:14,color:C.t1}}>{tx.l}</div>
                <div style={{fontSize:11,color:C.t3,marginTop:2}}>{tx.d}</div>
              </div>
              <div style={{fontSize:15,fontWeight:600,color:tx.c}}>{tx.a}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EDIT GROUP ───────────────────────────────────────────────────────────────
function EditGroupScreen({onBack,groupId,groups,um,updateGroup,toast}){
  const group=groups.find(g=>g.id===groupId);if(!group)return null;
  const [name,setName]=useState(group.name);
  const [emoji,setEmoji]=useState(group.emoji);
  const [members,setMembers]=useState(group.memberIds);
  const emojis=["🎓","👨‍👩‍👧‍👦","💼","🏖️","🎸","🍕","🏔️","✈️","🎉","🌍"];
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const searchUsers=async(q)=>{
    setSearchQuery(q);
    if(!q||q.length<2){setSearchResults([]);return;}
    setSearching(true);
    try{
      const res=await fetch("/api/users/search?q="+encodeURIComponent(q));
      if(res.ok){const {users}=await res.json();setSearchResults(users||[]);}
    }catch(e){setSearchResults([]);}
    finally{setSearching(false);}
  };
  const nonMembers=ALL_CONTACTS.filter(u=>!members.includes(u.id));
  const save=()=>{updateGroup(groupId,g=>({...g,name,emoji,memberIds:members}),{sync:true});toast("Group updated");onBack();};
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 18px"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:16,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Back</button>
        <div className="pt" style={{fontSize:24}}>Edit Group</div>
      </div>
      <div style={{padding:"0 20px",display:"flex",gap:12,alignItems:"center",marginBottom:18}}>
        <div style={{fontSize:44}}>{emoji}</div>
        <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="Group name" style={{flex:1}}/>
      </div>
      <div style={{padding:"0 20px 14px"}}>
        <div className="sl" style={{marginBottom:10}}>Choose an emoji</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {emojis.map(e=>(
            <button key={e} onClick={()=>setEmoji(e)} style={{width:42,height:42,borderRadius:12,fontSize:22,cursor:"pointer",border:`2px solid ${emoji===e?C.accent:C.border}`,background:emoji===e?C.accentDim:C.s2}}>{e}</button>
          ))}
        </div>
      </div>
      <div style={{height:1,background:C.border,margin:"6px 0 14px"}}/>
      <div style={{padding:"0 20px 10px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span className="sl">Members ({members.length})</span>
        <button style={{background:"linear-gradient(135deg,#C49A38,"+C.accent+")",color:"white",border:"none",
          borderRadius:12,padding:"7px 14px",fontSize:12,fontWeight:600,cursor:"pointer",
          fontFamily:"'Space Grotesk',sans-serif",boxShadow:"0 3px 12px rgba(212,168,67,0.2)"}}
          onClick={()=>{
            const msg="Hey! Join our group on Reach to help plan our next trip together. Download the app and take the quick quiz: https://reach-backend-gamma.vercel.app";
            if(navigator.share){navigator.share({title:"Join us on Reach",text:msg});}
            else{navigator.clipboard?.writeText(msg);alert("Invite link copied!");}
          }}>
          + Invite
        </button>
      </div>
      {members.map(uid=>{
        const u=um[uid];if(!u)return null;
        return(
          <div key={uid} className="ri">
            <Av u={u} lg/>
            <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
            <button className="bsm bsm-r" onClick={()=>setMembers(m=>m.filter(id=>id!==uid))}>Remove</button>
          </div>
        );
      })}
      {nonMembers.length>0&&(
        <>
          <div style={{padding:"14px 20px 10px"}}><span className="sl">Add Members</span></div>
          {nonMembers.map(u=>(
            <div key={u.id} className="ri" onClick={()=>setMembers(m=>[...m,u.id])}>
              <Av u={u} lg/>
              <div className="ri-inf"><div className="ri-t">{u.name}</div><div className="ri-s">{u.handle}</div></div>
              <button className="bsm bsm-p">+ Add</button>
            </div>
          ))}
        </>
      )}
      <div style={{padding:"18px 20px 30px"}}>
        <button className="bp" onClick={save}>Save Changes</button>
      </div>
    </div>
  );
}

// ─── CREATE GROUP ─────────────────────────────────────────────────────────────
const DEFAULT_GROUP_EMOJI="🎉";
function inferGroupEmoji(n){const s=(n||"").toLowerCase();const rules=[[/birthday|bday/,"🎂"],[/ski|snow|tahoe|aspen/,"🎿"],[/beach|cabo|cancun|island|bahamas|miami|playa|lake/,"🏝️"],[/concert|show|festival|music|tour/,"🎸"],[/dinner|food|restaurant|brunch|taco|pizza|omakase/,"🍕"],[/camp|hike|hiking|trail|mountain|yosemite|zion/,"🏕️"],[/vegas|party|bachelor|bachelorette/,"🎉"],[/golf/,"⛳"],[/wedding/,"💍"],[/road ?trip|drive/,"🚗"],[/europe|paris|tokyo|london|flight|abroad|trip|travel/,"✈️"]];for(const r of rules){if(r[0].test(s))return r[1];}return DEFAULT_GROUP_EMOJI;}
function CreateGroupScreen({onBack,setGroups,toast,um,saveGroupToServer}){
  const [step,setStep]=useState(0);
  const [name,setName]=useState("");
  const [emoji,setEmoji]=useState("🎉");
  const [members,setMembers]=useState([]);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchResults,setSearchResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const searchUsers=async(q)=>{
    setSearchQuery(q);
    if(!q||q.length<2){setSearchResults([]);return;}
    setSearching(true);
    try{
      const res=await fetch("/api/users/search?q="+encodeURIComponent(q));
      if(res.ok){const d=await res.json();setSearchResults(d.users||[]);}
    }catch(e){}
    finally{setSearching(false);}
  };
  const emojis=["🎓","👨‍👩‍👧‍👦","💼","🏖️","🎸","🍕","🏔️","✈️","🎉","🌍"];
  const create=()=>{
    const tempId="g_local_"+Date.now();
    const finalEmoji=(emoji&&emoji!==DEFAULT_GROUP_EMOJI)?emoji:inferGroupEmoji(name);const newGroup={id:tempId,name,emoji:finalEmoji,memberIds:members,wallet:0,tags:[],lastActivity:"Just created",plans:[]};
    setGroups(gs=>[...gs,newGroup]);
    toast(`${name} created!`);
    // Save to server in background
    if(typeof saveGroupToServer==="function")saveGroupToServer(newGroup);
    onBack();
  };
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 18px"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:16,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Cancel</button>
        <div className="pt">{step===0?"Name your group":"Add Members"}</div>
        <div className="sd" style={{marginTop:14}}>{[0,1].map(i=><div key={i} className={`sd-d ${i<=step?"active":""}`}/>)}</div>
      </div>
      {step===0&&(
        <div style={{padding:"0 20px"}}>
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:18}}>
            <div style={{fontSize:44}}>{emoji}</div>
            <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Ski Trip Crew" style={{flex:1}} autoFocus/>
          </div>
          <div className="sl" style={{marginBottom:10}}>Pick an emoji</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>
            {emojis.map(e=><button key={e} onClick={()=>setEmoji(e)} style={{width:44,height:44,borderRadius:12,fontSize:24,cursor:"pointer",border:`2px solid ${emoji===e?C.accent:C.border}`,background:emoji===e?C.accentDim:C.s2}}>{e}</button>)}
          </div>
          <button className="bp" disabled={!name.trim()} onClick={()=>setStep(1)}>Continue →</button>
        </div>
      )}
      {step===1&&(
        <div>
          <div style={{padding:"0 20px 12px",fontSize:13,color:C.t2}}>Invite people to {name||"your group"}</div>
          <div style={{padding:"0 20px 12px"}}>
            <input className="inp" value={searchQuery||""} onChange={e=>searchUsers(e.target.value)} placeholder="Search by name or email..." style={{marginBottom:8}}/>
            {searching&&<div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Searching...</div>}
            {(searchQuery||"").length>=2&&searchResults.length===0&&!searching&&(
              <div style={{fontSize:12,color:C.t3,padding:"8px 0"}}>No users found — they need to sign up at reach-backend-gamma.vercel.app first.</div>
            )}
            {(searchQuery||"").length<2&&(
              <div style={{fontSize:12,color:C.t3,padding:"4px 0"}}>Type a name or email address to find people.</div>
            )}
          </div>
          {searchResults.map(u=>{
            const sel=members.includes(u.id);
            const initials=(u.name||u.email||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
            return(
              <div key={u.id} className="cb-row" onClick={()=>setMembers(m=>sel?m.filter(id=>id!==u.id):[...m,u.id])}>
                <div className={"cb "+(sel?"ck":"")}>{sel&&<Ic.Check/>}</div>
                <div style={{width:36,height:36,borderRadius:"50%",background:C.accent,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:700,fontSize:14,flexShrink:0,overflow:"hidden"}}>
                  {u.avatar_url?<img src={u.avatar_url} style={{width:36,height:36,objectFit:"cover"}} alt=""/>:initials}
                </div>
                <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name||u.email}</div><div style={{fontSize:12,color:C.t2}}>{u.email}</div></div>
              </div>
            );
          })}
          {members.length>0&&(
            <div style={{padding:"0 20px 12px"}}>
              <div style={{fontSize:12,color:C.accent,fontWeight:500,marginBottom:8}}>{members.length} member{members.length!==1?"s":""} selected</div>
            </div>
          )}
          <div style={{padding:"18px 20px 30px"}}>
            <button className="bp" onClick={create}>Create {name||"group"}{members.length>0?" ("+members.length+" member"+(members.length!==1?"s":"")+"":""}{members.length>0?")":""}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CREATE PLAN FLOW ─────────────────────────────────────────────────────────

// ─── TRIP PLANNING QUIZ ───────────────────────────────────────────────────────
// Completely separate from the onboarding quiz.
// This fuels the AI trip generator with trip-specific preferences.
function TripQuiz({group,userLocation,error,onGenerate,allComplete,completedCount,totalCount,isSolo}){
  const [qStep,setQStep]=useState(0);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [answers,setAnswers]=useState({
    tripType:[],accommodation:[],budget:null,pace:null,noWayJose:[],
  });
  const [customInputs,setCustomInputs]=useState({
    tripType:"",accommodation:"",noWayJose:"",
  });
  const tog=(k,v)=>setAnswers(a=>({...a,[k]:a[k].includes(v)?a[k].filter(x=>x!==v):[...a[k],v]}));
  const sel=(k,v)=>setAnswers(a=>({...a,[k]:v}));
  const setCustom=(k,v)=>setCustomInputs(c=>({...c,[k]:v}));

  const nights=startDate&&endDate
    ?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  const questions=[
    {
      id:"tripType",icon:"🌍",
      title:"What kind of trip?",
      sub:"Pick all that apply.",
      multi:true,
      customPlaceholder:"Something else? Describe it…",
      options:[
        {id:"beach",e:"🏖️",l:"Beach & sun"},
        {id:"city",e:"🏙️",l:"City break"},
        {id:"nature",e:"🌿",l:"Nature & outdoors"},
        {id:"party",e:"🎉",l:"Party & nightlife"},
        {id:"wellness",e:"🧘",l:"Wellness & spa"},
        {id:"adventure",e:"🧗",l:"Adventure"},
      ]
    },
    {
      id:"accommodation",icon:"🏨",
      title:"Where do you want to stay?",
      sub:"Pick all that work.",
      multi:true,
      customPlaceholder:"Something specific in mind?",
      options:[
        {id:"hotel",e:"🏨",l:"Hotel"},
        {id:"resort",e:"🌴",l:"All-inclusive"},
        {id:"airbnb",e:"🏡",l:"Vacation rental"},
        {id:"villa",e:"🏰",l:"Private villa"},
        {id:"boutique",e:"✨",l:"Boutique hotel"},
        {id:"hostel",e:"🛏️",l:"Social hostel"},
      ]
    },
    {
      id:"budget",icon:"💰",
      title:"Budget per person?",
      sub:"Everything included — flights, hotel, food, activities.",
      isbudget:true,
      options:[
        {id:"1000",e:"💵",l:"Under $1k"},
        {id:"2000",e:"💳",l:"$1k – $2k"},
        {id:"3500",e:"✨",l:"$2k – $3.5k"},
        {id:"5000",e:"💎",l:"$3.5k – $5k"},
        {id:"10000",e:"🚀",l:"$5k – $10k"},
        {id:"unlimited",e:"♾️",l:"No limit"},
      ]
    },
    {
      id:"pace",icon:"⏱️",
      title:"What's the vibe?",
      options:[
        {id:"relaxed",e:"😌",l:"Relaxed"},
        {id:"balanced",e:"⚖️",l:"Balanced"},
        {id:"packed",e:"🔥",l:"See everything"},
        {id:"spontaneous",e:"🎲",l:"Spontaneous"},
        {id:"romantic",e:"💕",l:"Romantic"},
        {id:"wild",e:"🤪",l:"Go wild"},
      ]
    },
    {
      id:"noWayJose",icon:"🚫",
      title:"No Way José",
      sub:"Hard vetoes for this trip. Never appears in results.",
      noWay:true,
      multi:true,
      optional:true,
      customPlaceholder:"Anything else that's a hard no?",
      options:[
        {id:"camping",e:"⛺",l:"Camping"},
        {id:"longFlights",e:"✈️",l:"10+ hr flights"},
        {id:"coldWeather",e:"🥶",l:"Cold weather"},
        {id:"crowded",e:"👥",l:"Touristy traps"},
        {id:"earlyMornings",e:"⏰",l:"Early mornings"},
        {id:"hiking",e:"🥾",l:"Hiking"},
      ]
    },
  ];

  const isDateStep=qStep===0;
  const quizQ=questions[qStep-1];
  const totalSteps=questions.length+1;
  const isLast=qStep===totalSteps-1;
  const canNext=isDateStep
    ?(startDate&&endDate&&nights>0)
    :(quizQ?.optional||(quizQ?.multi?(answers[quizQ?.id]||[]).length>0:!!answers[quizQ?.id]));

  const handleGenerate=()=>{
    // Merge custom inputs into answers
    const merged={...answers};
    Object.entries(customInputs).forEach(([k,v])=>{
      if(v&&v.trim()){
        if(Array.isArray(merged[k]))merged[k]=[...merged[k],"custom:"+v.trim()];
      }
    });
    const budgetNum=merged.budget==="unlimited"||merged.budget==="10000"?null:parseInt(merged.budget)||null;
    onGenerate({start:startDate,end:endDate},budgetNum,{...merged,nights});
  };

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg}}>
      {/* Progress */}
      <div style={{padding:"16px 20px 12px"}}>
        <div style={{display:"flex",gap:3,marginBottom:8}}>
          {Array.from({length:totalSteps}).map((_,i)=>(
            <div key={i} style={{flex:1,height:3,borderRadius:2,
              background:i<=qStep?C.accent:C.s3,transition:"background .3s"}}/>
          ))}
        </div>
        <div style={{fontSize:11,color:C.t3}}>Step {qStep+1} of {totalSteps}</div>
      </div>

      {/* Date step */}
      {isDateStep&&(
        <div style={{flex:1,overflowY:"auto",padding:"8px 20px 20px"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:44,marginBottom:10}}>📅</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1,marginBottom:6}}>
              When are you going?
            </div>
            <div style={{fontSize:14,color:C.t2}}>
              Departing from {userLocation?.formatted||"your location"}
              {userLocation?.airport&&" ("+userLocation.airport+")"}
            </div>
          </div>
          {error&&isDateStep&&(
            <div style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.2)",borderRadius:12,padding:12,marginBottom:16,fontSize:13,color:C.red,display:"flex",alignItems:"center",gap:8}}>
              <span>⚠️</span>
              <div>
                <div style={{fontWeight:600,marginBottom:2}}>Generation failed</div>
                <div style={{fontSize:12,opacity:.8}}>{error} — check your Anthropic API key in Vercel</div>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Departure</div>
              <input type="date" className="inp" value={startDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:6}}>Return</div>
              <input type="date" className="inp" value={endDate}
                min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
            </div>
          </div>
          {nights>0&&(
            <div style={{textAlign:"center",padding:"14px",background:C.accentDim,
              border:"1px solid "+C.accentBorder,borderRadius:14,marginBottom:16}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.accent}}>
                {nights} night{nights!==1?"s":""}
              </div>
              <div style={{fontSize:13,color:C.t2,marginTop:2}}>
                {nights<=2?"Quick getaway":nights<=4?"Weekend trip":nights<=7?"Week adventure":"Extended trip"}
                {" · "}{group.memberIds?.length||2} people
              </div>
            </div>
          )}
          <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:14,padding:14}}>
            <div style={{fontSize:12,fontWeight:600,color:C.t1,marginBottom:4}}>
              ✨ AI reads everyone's preferences
            </div>
            <div style={{fontSize:12,color:C.t2,lineHeight:1.6}}>
              Combines your quiz answers with all {group.memberIds?.length||0} members' food, music, and activity preferences.
            </div>
          </div>
        </div>
      )}

      {/* Quiz questions */}
      {!isDateStep&&quizQ&&(
        <div style={{flex:1,display:"flex",flexDirection:"column"}}>
          <div style={{padding:"8px 20px 14px",textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:8}}>{quizQ.icon}</div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,
              color:quizQ.noWay?C.red:C.t1,lineHeight:1.2,marginBottom:4}}>
              {quizQ.title}
            </div>
            {quizQ.sub&&<div style={{fontSize:13,color:C.t2}}>{quizQ.sub}</div>}
            {quizQ.noWay&&(
              <div style={{marginTop:8,padding:"6px 14px",
                background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",
                borderRadius:10,display:"inline-block"}}>
                <div style={{fontSize:12,color:C.red}}>
                  🚫 These will <strong>never</strong> appear in your options
                </div>
              </div>
            )}
          </div>

          <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"0 20px 8px"}}>
            {/* 6 option grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
              {quizQ.options.map(opt=>{
                const isMulti=quizQ.multi;
                const selected=isMulti
                  ?(answers[quizQ.id]||[]).includes(opt.id)
                  :answers[quizQ.id]===opt.id;
                const isVeto=quizQ.noWay&&selected;
                return(
                  <button key={opt.id}
                    onClick={()=>isMulti?tog(quizQ.id,opt.id):sel(quizQ.id,opt.id)}
                    style={{
                      padding:"14px 8px",borderRadius:14,
                      border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),
                      background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,
                      cursor:"pointer",textAlign:"center",
                      fontFamily:"'Space Grotesk',sans-serif",transition:"all .15s",
                    }}>
                    <div style={{fontSize:24,marginBottom:4}}>{opt.e}</div>
                    <div style={{fontSize:11,fontWeight:600,lineHeight:1.2,
                      color:isVeto?"#EF4444":selected?C.accent:C.t1}}>{opt.l}</div>
                  </button>
                );
              })}
            </div>

            {/* 7th option: custom text input */}
            {quizQ.customPlaceholder&&(
              <div style={{marginBottom:8}}>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:18}}>✏️</span>
                  <input
                    className="inp"
                    style={{paddingLeft:44,fontSize:13}}
                    value={customInputs[quizQ.id]||""}
                    onChange={e=>setCustom(quizQ.id,e.target.value)}
                    placeholder={quizQ.customPlaceholder}
                  />
                </div>
                {customInputs[quizQ.id]&&(
                  <div style={{fontSize:12,color:C.accent,marginTop:4,paddingLeft:4}}>
                    ✓ Added: {customInputs[quizQ.id]}
                  </div>
                )}
              </div>
            )}

            {quizQ.multi&&(answers[quizQ.id]||[]).length>0&&(
              <div style={{textAlign:"center",fontSize:12,color:C.accent,fontWeight:500,padding:"4px 0"}}>
                {(answers[quizQ.id]||[]).length} selected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{padding:"12px 20px 44px",display:"flex",gap:10}}>
        {qStep>0&&(
          <button className="bs" style={{flex:1}} onClick={()=>setQStep(s=>s-1)}>← Back</button>
        )}
        {isLast?(
          <button className="bp" style={{flex:2,
            background:!allComplete?"linear-gradient(135deg,#F59E0B,#EF4444)":undefined}}
            onClick={handleGenerate}>
            {isSolo?"✨ Build my solo trip":allComplete?"✨ Generate trips for "+group.name:"⚠️ Generate anyway ("+completedCount+"/"+totalCount+" ready)"}
          </button>
        ):(
          <button className="bp" style={{flex:2}} disabled={!canNext}
            onClick={()=>setQStep(s=>s+1)}>
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}


function GroupTripScreen({onBack,groupId,groups,updateGroup,toast,push,userLocation,savePlanToServer}){
  const group=groups.find(g=>g.id===groupId);
  const [step,setStep]=useState(0);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [budget,setBudget]=useState("");
  const [trips,setTrips]=useState(null);
  const [vetoes,setVetoes]=useState({});
  const [votes,setVotes]=useState({});
  const [myVote,setMyVote]=useState(null);
  const [myVetoes,setMyVetoes]=useState(new Set());
  const [generating,setGenerating]=useState(false);
  const [error,setError]=useState(null);
  const [tripPrefs,setTripPrefs]=useState({});
  const [memberStatus,setMemberStatus]=useState({}); // {userId: {name,quizDone,avatar}}
  const [loadingStatus,setLoadingStatus]=useState(false);

  useEffect(()=>{if(step===0)setError(null);},[step]);

  // Load quiz completion status for all members
  useEffect(()=>{
    if(!group)return;
    loadMemberStatus();
    // Poll every 15 seconds so status updates live
    const interval=setInterval(loadMemberStatus,15000);
    return()=>clearInterval(interval);
  },[groupId]);

  const loadMemberStatus=async()=>{
    setLoadingStatus(true);
    try{
      const res=await fetch("/api/groups/"+groupId+"/quiz-status");
      if(res.ok){
        const data=await res.json();
        setMemberStatus(data.members||{});
      }
    }catch(e){}
    setLoadingStatus(false);
  };

  const membersList=Object.values(memberStatus);
  const completedCount=membersList.filter(m=>m.quizDone).length;
  const rawTotal=membersList.length||group.memberIds?.length||1;
  const isSolo=rawTotal<=1;
  const totalCount=isSolo?1:rawTotal;
  const allComplete=isSolo||(completedCount>=totalCount&&totalCount>0);
  const readyPercent=isSolo?100:totalCount>0?Math.round((completedCount/totalCount)*100):0;

  if(!group)return null;

  const nights=startDate&&endDate?Math.round((new Date(endDate)-new Date(startDate))/86400000):0;

  const generate=async(sd,ed,bud,prefs={},retrying=false)=>{
    setStep(1);setGenerating(true);setError(null);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate:sd||startDate,
          endDate:ed||endDate,
          budgetPerPerson:parseInt(bud||budget)||null,
          departureCity:userLocation?.formatted||userLocation?.city||null,
          departureAirport:userLocation?.airport||null,
          userLat:userLocation?.lat||null,
          userLng:userLocation?.lng||null,
          tripPrefs:prefs,
        }),
      });
      if(res.ok){
        const data=await res.json();
        if(data.trips&&data.trips.length>0){
          setTrips(data.trips);
          setStep(2);
        }else{
          setError("No trips returned — try different dates or budget");
          setStep(0);
        }
      }else{
        const err=await res.json().catch(()=>({}));
        const msg=err.error||"Generation failed";
        // Auto-retry once on parse failures
        if(!retrying&&(msg.includes("parsing")||msg.includes("parse"))){
          setGenerating(false);
          setTimeout(()=>generate(sd,ed,bud,prefs,true),1000);
          return;
        }
        setError(msg);
        setStep(0);
      }
    }catch(e){
      setError("Network error — check your connection and try again");
      setStep(0);
    }finally{setGenerating(false);}
  };

  const veto=(tripId)=>{
    setMyVetoes(v=>{
      const next=new Set(v);
      next.has(tripId)?next.delete(tripId):next.add(tripId);
      return next;
    });
  };

  const vote=(tripId)=>{
    if(myVote===tripId){setMyVote(null);setVotes(v=>({...v,[tripId]:Math.max(0,(v[tripId]||1)-1)}));}
    else{
      if(myVote)setVotes(v=>({...v,[myVote]:Math.max(0,(v[myVote]||1)-1)}));
      setMyVote(tripId);
      setVotes(v=>({...v,[tripId]:(v[tripId]||0)+1}));
    }
  };

  const [buildingItinerary,setBuildingItinerary]=useState(null);

  const selectTrip=async(trip)=>{
    // Save plan immediately with placeholder itinerary
    const np={
      id:"p"+Date.now(),
      title:trip.destination,
      status:"approved",
      dates:startDate&&endDate?startDate+" – "+endDate:"Dates TBD",
      budget:trip.total_per_person,
      type:"trip",
      participants:group.memberIds||[],
      itinerary:[],
      votes:{},options:[],
      aiGenerated:true,aiData:trip,
    };
    updateGroup(groupId,g=>({...g,plans:[...g.plans,np],lastActivity:"Planning: "+trip.destination}));
    toast(trip.destination+" saved! Building itinerary… ✨");
    if(savePlanToServer)savePlanToServer(groupId,np);

    // Fetch full itinerary in background
    setBuildingItinerary(trip.id);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,
          startDate,endDate,
          detailTripId:trip.id,
          tripData:{destination:trip.destination,vibe:trip.vibe,costs:trip.costs},
          departureCity:userLocation?.formatted||null,
          departureAirport:userLocation?.airport||null,
        }),
      });
      if(res.ok){
        const data=await res.json();
        const itinerary=(data.itinerary||[]).flatMap((day)=>[
          {time:"Day "+day.day+" AM",title:day.morning,sub:day.title,type:"activity",conf:null,filled:false},
          {time:"Day "+day.day+" PM",title:day.afternoon,sub:"",type:"activity",conf:null,filled:false},
          {time:"Day "+day.day+" Eve",title:day.evening,sub:day.insider_tip||"",type:"restaurant",conf:null,filled:false},
        ]);
        updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===np.id?{...p,itinerary}:p)}));
        toast("Full itinerary ready for "+trip.destination+" 🗺️");
      }
    }catch(e){console.log("Itinerary generation failed",e);}
    setBuildingItinerary(null);
    push("planDetail",{planId:np.id,groupId});
  };

  const activeTrips=(trips||[]).filter(t=>!myVetoes.has(t.id));
  const vetoedTrips=(trips||[]).filter(t=>myVetoes.has(t.id));

  return(
    <div className="sc">
      {/* Header */}
      <div style={{padding:"12px 20px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex"}}><Ic.ChevL/></button>
        <div style={{flex:1}}>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>
            {group.emoji} {group.name}
          </div>
          <div style={{fontSize:12,color:C.t2}}>
            {step===0?"Set your trip details":step===1?"Finding your perfect trips…":"Pick your trip"}
          </div>
        </div>
      </div>

      {/* ── STEP 0: Member readiness + Trip Planning Quiz ── */}
      {step===0&&(
        <>
          {/* Member quiz status - only show for groups, not solo */}
          {!isSolo&&(
          <div style={{padding:"0 20px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:600,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>
                Group readiness
              </div>
              <div style={{fontSize:12,color:allComplete?C.green:C.accent,fontWeight:600}}>
                {completedCount}/{totalCount} ready
              </div>
            </div>

            {/* Progress bar for groups */}
            <div style={{height:5,background:C.s3,borderRadius:3,marginBottom:12,overflow:"hidden"}}>
              <div style={{height:"100%",width:readyPercent+"%",borderRadius:3,
                background:allComplete?"linear-gradient(90deg,"+C.green+",#52C97B)":"linear-gradient(90deg,#C49A38,"+C.accent+")",
                transition:"width .5s ease"}}/>
            </div>

            {/* Member list */}
            {membersList.length>0?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {membersList.map((m,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                    background:m.quizDone?C.s2:"rgba(239,68,68,.06)",
                    border:"1px solid "+(m.quizDone?C.border:"rgba(239,68,68,.15)"),
                    borderRadius:12}}>
                    <div style={{width:32,height:32,borderRadius:"50%",
                      background:m.quizDone?C.accent:C.s3,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:13,fontWeight:700,color:"white",flexShrink:0,overflow:"hidden"}}>
                      {m.avatar?<img src={m.avatar} style={{width:32,height:32,objectFit:"cover"}} alt=""/>
                        :(m.name||"?")[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.t1}}>{m.name||"Member"}</div>
                      <div style={{fontSize:11,color:m.quizDone?C.green:"#EF4444",marginTop:1}}>
                        {m.quizDone?"✓ Preferences ready":"⏳ Quiz not complete"}
                      </div>
                    </div>
                    {m.quizDone&&m.topPrefs&&(
                      <div style={{fontSize:11,color:C.t3,textAlign:"right",maxWidth:100,lineHeight:1.4}}>
                        {m.topPrefs.slice(0,2).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ):(
              <div style={{textAlign:"center",padding:"8px 0",color:C.t3,fontSize:12}}>
                {loadingStatus?"Checking group status…":""}
              </div>
            )}

            {!isSolo&&!allComplete&&(
              <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(212,168,67,0.08),rgba(196,154,56,0.04))",
                border:"1px solid rgba(212,168,67,0.2)",borderRadius:18,padding:"16px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:12}}>
                  <div style={{width:40,height:40,borderRadius:12,
                    background:"linear-gradient(135deg,rgba(124,110,255,0.2),rgba(168,85,247,0.2))",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>
                    ✨
                  </div>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:C.t1,marginBottom:4}}>
                      Waiting on {totalCount-completedCount} {totalCount-completedCount===1?"member":"members"}
                    </div>
                    <div style={{fontSize:13,color:C.t2,lineHeight:1.6}}>
                      Reach builds better trips when everyone shares their preferences. Remind your crew to complete their quiz.
                    </div>
                  </div>
                </div>
                <button onClick={()=>{
                  const msg="Hey! We're planning a trip on Reach and need your preferences to build the perfect options. Take 2 minutes to complete your quiz: https://reach-backend-gamma.vercel.app";
                  if(navigator.share){navigator.share({title:"Complete your Reach quiz",text:msg});}
                  else{navigator.clipboard?.writeText(msg);toast("Invite link copied! 📋");}
                }} style={{width:"100%",padding:"11px 16px",
                  background:"linear-gradient(135deg,#C49A38,"+C.accent+")",
                  color:"white",border:"none",borderRadius:14,
                  fontSize:13,fontWeight:600,cursor:"pointer",
                  fontFamily:"'Space Grotesk',sans-serif",
                  boxShadow:"0 4px 16px rgba(212,168,67,0.25)"}}>
                  📲 Invite them to complete quiz
                </button>
              </div>
            )}

            {(allComplete||isSolo)&&(
              <div style={{marginTop:12,background:"linear-gradient(135deg,rgba(52,211,153,0.08),rgba(52,211,153,0.04))",
                border:"1px solid rgba(52,211,153,0.2)",borderRadius:18,padding:"14px 16px",
                display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:36,height:36,borderRadius:10,
                  background:"rgba(52,211,153,0.15)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                  ✅
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:C.green}}>Everyone's ready!</div>
                  <div style={{fontSize:12,color:C.t2,marginTop:2}}>
                    AI is reading all {totalCount} members' preferences to build your perfect trips.
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Solo banner - only show for solo */}
          {isSolo&&(
            <div style={{padding:"0 20px 16px"}}>
              <div style={{background:"linear-gradient(135deg,rgba(212,168,67,0.1),rgba(196,154,56,0.05))",
                border:"1px solid rgba(212,168,67,0.25)",borderRadius:20,padding:"16px",
                display:"flex",alignItems:"center",gap:14}}>
                <div style={{width:48,height:48,borderRadius:16,
                  background:"linear-gradient(135deg,rgba(212,168,67,0.2),rgba(196,154,56,0.1))",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,flexShrink:0}}>
                  🧳
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:600,color:C.t1,marginBottom:3}}>Solo trip</div>
                  <div style={{fontSize:13,color:C.t2,lineHeight:1.5}}>
                    Just for you. Add friends from group settings anytime.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{height:1,background:C.border,margin:"0 20px 16px"}}/>

          <TripQuiz
            group={group}
            userLocation={userLocation}
            error={error}
            allComplete={allComplete}
            completedCount={completedCount}
            totalCount={totalCount}
            isSolo={isSolo}
            onGenerate={(dates,tripBudget,prefs)=>{
              setStartDate(dates.start);
              setEndDate(dates.end);
              setBudget(tripBudget);
              setTripPrefs(prefs);
              generate(dates.start,dates.end,tripBudget,prefs);
            }}
          />
        </>
      )}

      {/* ── STEP 1: Generating ── */}
      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40,textAlign:"center"}}>
          <div style={{fontSize:60,marginBottom:20}}>✨</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,marginBottom:12}}>
            Building trips for {group.name}
          </div>
          <div style={{fontSize:14,color:C.t2,lineHeight:1.8,marginBottom:30,maxWidth:280}}>
            Reading everyone's food preferences,<br/>
            music taste, and activity vibes...<br/>
            Finding flights from {userLocation?.airport||"your city"},<br/>
            hotels, restaurants, and experiences...
          </div>
          <div style={{width:240,height:4,background:C.s3,borderRadius:2,overflow:"hidden",marginBottom:20}}>
            <div style={{height:"100%",background:"linear-gradient(90deg,"+C.accent+",#C084FC)",borderRadius:2,animation:"loading 1.5s ease-in-out infinite"}}/>
          </div>
          <div style={{fontSize:12,color:C.t3}}>Usually takes 5-8 seconds</div>
          <style>{`@keyframes loading{0%{width:0%}50%{width:100%}100%{width:0%;margin-left:100%}}`}</style>
        </div>
      )}

      {/* ── STEP 2: Results ── */}
      {step===2&&trips&&(
        <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none"}}>
          <div style={{padding:"0 20px 12px"}}>
            <div style={{fontSize:14,color:C.t2,lineHeight:1.6}}>
              3 options built around {group.name}'s preferences.{" "}
              <span style={{color:C.red}}>❌ Veto</span> anything you won't do.{" "}
              <span style={{color:C.accent}}>❤️ Vote</span> for your favorite.
            </div>
          </div>

          {activeTrips.map((trip,i)=>{
            const voted=myVote===trip.id;
            const voteCount=votes[trip.id]||0;
            return(
              <div key={trip.id} style={{margin:"0 20px 20px"}}>
                <div style={{background:C.s1,border:"2px solid "+(voted?C.accent:C.border),borderRadius:20,overflow:"hidden",transition:"border-color .2s"}}>

                  {/* Trip header */}
                  <div style={{padding:"18px 18px 14px",background:voted?C.accentDim:C.s2}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:32,marginBottom:6}}>{trip.emoji}</div>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:4}}>
                          {trip.destination}
                        </div>
                        <div style={{fontSize:13,color:C.t2,lineHeight:1.5,marginBottom:8}}>
                          {trip.tagline}
                        </div>
                        {trip.why_this_group&&(
                          <div style={{fontSize:12,color:C.accent,fontWeight:500}}>
                            ✨ {trip.why_this_group}
                          </div>
                        )}
                      </div>
                      <div style={{textAlign:"right",marginLeft:12}}>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:voted?C.accent:C.t1}}>
                          ${trip.total_per_person?.toLocaleString()}
                        </div>
                        <div style={{fontSize:11,color:C.t3}}>per person</div>
                        <div style={{fontSize:11,color:C.t3}}>{nights} nights</div>
                      </div>
                    </div>
                    <div style={{display:"inline-block",background:C.s3,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.t2,marginTop:8}}>
                      {trip.vibe}
                    </div>
                  </div>

                  {/* Cost breakdown */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                      Full cost breakdown per person
                    </div>
                    {[
                      {icon:"✈️",label:"Flights",cost:trip.costs?.flights?.per_person,detail:trip.costs?.flights?.details},
                      {icon:"🏨",label:"Hotel",cost:trip.costs?.accommodation?.per_person,detail:trip.costs?.accommodation?.example},
                      {icon:"🚗",label:"Transport",cost:trip.costs?.ground_transport?.per_person,detail:trip.costs?.ground_transport?.details},
                      {icon:"🍽️",label:"Food & drinks",cost:trip.costs?.food_drink?.per_person,detail:trip.costs?.food_drink?.details},
                      {icon:"🎯",label:"Activities & events",cost:trip.costs?.activities?.per_person,detail:trip.costs?.activities?.details},
                      {icon:"🛡️",label:"Insurance & misc",cost:trip.costs?.misc?.per_person,detail:trip.costs?.misc?.details},
                    ].filter(c=>c.cost).map((c,j)=>(
                      <div key={j} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
                        <span style={{fontSize:16,width:22,flexShrink:0,marginTop:1}}>{c.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{c.label}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{c.detail}</div>
                        </div>
                        <div style={{fontSize:14,fontWeight:600,color:C.t1,flexShrink:0}}>${c.cost}</div>
                      </div>
                    ))}
                    <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid "+C.border,display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Total per person</div>
                      <div style={{fontSize:16,fontWeight:700,color:voted?C.accent:C.t1}}>${trip.total_per_person?.toLocaleString()}</div>
                    </div>
                    {group.memberIds?.length>1&&(
                      <div style={{fontSize:12,color:C.t3,textAlign:"right",marginTop:2}}>
                        ${(trip.total_per_person*(group.memberIds?.length||2))?.toLocaleString()} total for the group
                      </div>
                    )}
                  </div>

                  {/* Itinerary preview */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                      Day-by-day
                    </div>
                    {(trip.itinerary||[]).slice(0,2).map((day,j)=>(
                      <div key={j} style={{marginBottom:12,paddingBottom:12,borderBottom:j<1?"1px solid "+C.border:"none"}}>
                        <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:6}}>
                          Day {day.day} · {day.title}
                        </div>
                        <div style={{fontSize:12,color:C.t2,lineHeight:1.7}}>
                          ☀️ {day.morning}<br/>
                          🌤️ {day.afternoon}<br/>
                          🌙 {day.evening}
                        </div>
                        {day.insider_tip&&(
                          <div style={{fontSize:11,color:C.t3,marginTop:4,fontStyle:"italic",background:C.s2,padding:"6px 10px",borderRadius:8}}>
                            💡 {day.insider_tip}
                          </div>
                        )}
                      </div>
                    ))}
                    {(trip.itinerary||[]).length>2&&(
                      <div style={{fontSize:12,color:C.accent,fontWeight:500}}>
                        + {trip.itinerary.length-2} more days in full itinerary after you pick this
                      </div>
                    )}
                  </div>

                  {/* Scene info */}
                  {(trip.food_scene||trip.music_scene)&&(
                    <div style={{padding:"12px 18px",borderBottom:"1px solid "+C.border,display:"flex",gap:12}}>
                      {trip.food_scene&&(
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,color:C.t3,marginBottom:3}}>🍽️ Food scene</div>
                          <div style={{fontSize:12,color:C.t2,lineHeight:1.4}}>{trip.food_scene}</div>
                        </div>
                      )}
                      {trip.music_scene&&(
                        <div style={{flex:1}}>
                          <div style={{fontSize:11,color:C.t3,marginBottom:3}}>🎵 Music scene</div>
                          <div style={{fontSize:12,color:C.t2,lineHeight:1.4}}>{trip.music_scene}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{padding:"14px 18px",display:"flex",gap:8}}>
                    <button onClick={()=>veto(trip.id)}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        border:"1px solid rgba(239,68,68,.4)",
                        background:"rgba(239,68,68,.08)",
                        color:C.red,fontSize:13,fontWeight:600,
                        cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                      ❌ Veto
                    </button>
                    <button onClick={()=>vote(trip.id)}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        border:"1px solid "+(voted?C.accent:C.border),
                        background:voted?C.accentDim:"none",
                        color:voted?C.accent:C.t2,fontSize:13,fontWeight:600,
                        cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                      {voted?"❤️ Voted":"🤍 Vote"}
                      {voteCount>0&&" ("+voteCount+")"}
                    </button>
                    <button onClick={()=>selectTrip(trip)}
                      disabled={!!buildingItinerary}
                      style={{flex:1,padding:"12px 8px",borderRadius:12,
                        background:buildingItinerary===trip.id?"rgba(108,99,255,.5)":C.accent,
                        color:"white",border:"none",
                        fontSize:13,fontWeight:600,
                        cursor:buildingItinerary?"not-allowed":"pointer",
                        fontFamily:"'Space Grotesk',sans-serif"}}>
                      {buildingItinerary===trip.id?"Building… ✨":"✓ Pick this"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Vetoed trips */}
          {vetoedTrips.length>0&&(
            <div style={{padding:"0 20px 16px"}}>
              <div style={{fontSize:12,color:C.t3,marginBottom:10}}>Vetoed by you</div>
              {vetoedTrips.map(trip=>(
                <div key={trip.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:C.s2,borderRadius:14,marginBottom:8,opacity:.6}}>
                  <span style={{fontSize:24}}>{trip.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,color:C.t2,textDecoration:"line-through"}}>{trip.destination}</div>
                  </div>
                  <button onClick={()=>veto(trip.id)}
                    style={{fontSize:12,color:C.accent,background:"none",border:"none",cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                    Undo
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Regenerate */}
          <div style={{padding:"0 20px 40px"}}>
            <button className="bs" style={{width:"100%"}} onClick={()=>{setStep(0);setTrips(null);setVetoes({});setVotes({});setMyVote(null);setMyVetoes(new Set());}}>
              ↺ Generate different options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── AI TRIP GENERATOR ────────────────────────────────────────────────────────
function AiTripScreen({onBack,groups,updateGroup,toast,push,userLocation}){
  const [groupId,setGroupId]=useState(null);
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [budget,setBudget]=useState("");
  const [loading,setLoading]=useState(false);
  const [trips,setTrips]=useState(null);
  const [vetoes,setVetoes]=useState({});
  const [votes,setVotes]=useState({});
  const [step,setStep]=useState(0); // 0=setup 1=loading 2=results 3=voted
  const selGroup=groups.find(g=>g.id===groupId);

  const generate=async()=>{
    if(!groupId)return;
    setStep(1);setLoading(true);
    try{
      const res=await fetch("/api/trips/generate",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          groupId,startDate,endDate,
          budgetPerPerson:parseInt(budget)||null,
          departureCity:userLocation?.formatted||userLocation?.city||null,
          departureAirport:userLocation?.airport||null,
          userLat:userLocation?.lat||null,
          userLng:userLocation?.lng||null,
        }),
      });
      if(res.ok){
        const data=await res.json();
        setTrips(data.trips);
        setStep(2);
      }else{
        toast("AI trip generation failed — check your API key");
        setStep(0);
      }
    }catch(e){
      toast("Network error — try again");
      setStep(0);
    }finally{setLoading(false);}
  };

  const veto=(tripId)=>setVetoes(v=>({...v,[tripId]:!v[tripId]}));
  const vote=(tripId)=>setVotes(v=>({...v,[tripId]:!v[tripId]}));

  const activeTips=trips?.filter(t=>!vetoes[t.id]);
  const topVoted=activeTips?.sort((a,b)=>(votes[b.id]?1:0)-(votes[a.id]?1:0))[0];

  const saveToPlan=async(trip)=>{
    if(!groupId)return;
    const newPlan={
      id:"p"+Date.now(),
      title:trip.destination,
      status:"voting",
      dates:startDate&&endDate?`${startDate} – ${endDate}`:"Dates TBD",
      budget:trip.total_per_person,
      type:"trip",
      participants:selGroup?.memberIds||[],
      itinerary:(trip.itinerary||[]).flatMap(day=>([
        {time:`Day ${day.day} AM`,title:day.morning,sub:day.title,type:"activity",conf:null,filled:false},
        {time:`Day ${day.day} PM`,title:day.afternoon,sub:"",type:"activity",conf:null,filled:false},
        {time:`Day ${day.day} Eve`,title:day.evening,sub:day.tips||"",type:"restaurant",conf:null,filled:false},
      ])),
      votes:{},
      options:[],
      aiGenerated:true,
      aiData:trip,
    };
    updateGroup(groupId,g=>({...g,plans:[...g.plans,newPlan]}));
    toast("Trip saved to "+selGroup?.name+"! 🎉");
    push("planDetail",{planId:newPlan.id,groupId});
  };

  return(
    <div className="sc">
      <div style={{padding:"12px 20px 0",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex"}}><Ic.ChevL/></button>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>AI Trip Planner ✨</div>
      </div>

      {step===0&&(
        <div style={{padding:"20px 20px 30px",overflowY:"auto",flex:1}}>
          <div style={{background:C.accentDim,border:"1px solid "+C.accentBorder,borderRadius:16,padding:16,marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:600,color:C.accent,marginBottom:4}}>How it works</div>
            <div style={{fontSize:13,color:C.t2,lineHeight:1.7}}>
              Reach reads every group member's travel preferences and generates 3 complete trip options — with real costs for flights, hotels, food, and activities. Your group votes. Any absolute veto cuts a destination. The winner gets booked.
            </div>
          </div>

          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:8}}>Which group?</div>
            {groups.map(g=>(
              <div key={g.id} onClick={()=>setGroupId(g.id)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderRadius:14,border:"2px solid "+(groupId===g.id?C.accent:C.border),background:groupId===g.id?C.accentDim:C.s2,marginBottom:8,cursor:"pointer"}}>
                <span style={{fontSize:24}}>{g.emoji}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{g.name}</div>
                  <div style={{fontSize:12,color:C.t2}}>{g.memberIds?.length||0} members · preferences loaded</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:10,marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Departure</div>
              <input type="date" className="inp" value={startDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Return</div>
              <input type="date" className="inp" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
            </div>
          </div>

          <div style={{marginBottom:24}}>
            <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Max budget per person (optional)</div>
            <input className="inp" type="number" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="Leave blank to use group preferences"/>
          </div>

          <button className="bp" onClick={generate} disabled={!groupId} style={{width:"100%"}}>
            ✨ Generate 3 AI Trip Options
          </button>
          <div style={{fontSize:12,color:C.t3,textAlign:"center",marginTop:10}}>
            AI reads all {selGroup?.memberIds?.length||"your"} members' preferences
          </div>
        </div>
      )}

      {step===1&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40}}>
          <div style={{fontSize:48,marginBottom:20}}>✨</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:12,textAlign:"center"}}>Building your trips...</div>
          <div style={{fontSize:14,color:C.t2,textAlign:"center",lineHeight:1.7,marginBottom:24}}>
            Reading everyone's preferences,<br/>finding flights, hotels, and activities,<br/>building full itineraries with real costs...
          </div>
          <div style={{width:200,height:4,background:C.s3,borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",background:C.accent,borderRadius:2,animation:"loading 2s ease-in-out infinite"}}/>
          </div>
          <style>{`@keyframes loading{0%{width:0}50%{width:100%}100%{width:0}}`}</style>
        </div>
      )}

      {step===2&&trips&&(
        <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"20px 0"}}>
          <div style={{padding:"0 20px 16px"}}>
            <div style={{fontSize:14,color:C.t2}}>
              3 trips built for <strong style={{color:C.t1}}>{selGroup?.name}</strong> · Tap ❌ to veto, ❤️ to vote
            </div>
          </div>

          {trips.map((trip,i)=>{
            const vetoed=vetoes[trip.id];
            const voted=votes[trip.id];
            return(
              <div key={trip.id} style={{margin:"0 20px 20px",opacity:vetoed?.4:1,transition:"opacity .3s"}}>
                <div style={{background:C.s1,border:"1px solid "+(voted?C.accent:vetoed?C.red:C.border),borderRadius:20,overflow:"hidden"}}>

                  {/* Header */}
                  <div style={{padding:"18px 18px 14px",background:voted?C.accentDim:vetoed?"rgba(239,68,68,.08)":C.s2}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:8}}>
                      <div>
                        <div style={{fontSize:28,marginBottom:4}}>{trip.emoji}</div>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:vetoed?C.t3:C.t1}}>{trip.destination}</div>
                        <div style={{fontSize:13,color:C.t2,marginTop:2}}>{trip.tagline}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:voted?C.accent:C.t1}}>${trip.total_per_person.toLocaleString()}</div>
                        <div style={{fontSize:11,color:C.t3}}>per person</div>
                      </div>
                    </div>
                    <div style={{display:"inline-block",background:C.s3,borderRadius:20,padding:"4px 12px",fontSize:12,color:C.t2}}>{trip.vibe}</div>
                  </div>

                  {/* Cost breakdown */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Cost breakdown</div>
                    {[
                      {icon:"✈️",label:"Flights",cost:trip.costs?.flights?.per_person,detail:trip.costs?.flights?.details},
                      {icon:"🏨",label:"Hotel",cost:trip.costs?.accommodation?.per_person,detail:trip.costs?.accommodation?.example},
                      {icon:"🚗",label:"Transport",cost:trip.costs?.ground_transport?.per_person,detail:trip.costs?.ground_transport?.details},
                      {icon:"🍽️",label:"Food & drinks",cost:trip.costs?.food_drink?.per_person,detail:trip.costs?.food_drink?.details},
                      {icon:"🎯",label:"Activities",cost:trip.costs?.activities?.per_person,detail:trip.costs?.activities?.details},
                      {icon:"🛡️",label:"Insurance + misc",cost:trip.costs?.misc?.per_person,detail:trip.costs?.misc?.details},
                    ].map((c,j)=>c.cost?(
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <span style={{fontSize:16,width:24,flexShrink:0}}>{c.icon}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,color:C.t1}}>{c.label}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{c.detail}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:600,color:C.t1}}>${c.cost}</div>
                      </div>
                    ):null)}
                  </div>

                  {/* Itinerary preview */}
                  <div style={{padding:"14px 18px",borderBottom:"1px solid "+C.border}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Day-by-day</div>
                    {(trip.itinerary||[]).slice(0,3).map((day,j)=>(
                      <div key={j} style={{marginBottom:10}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:3}}>Day {day.day} · {day.title}</div>
                        <div style={{fontSize:12,color:C.t2,lineHeight:1.5}}>
                          ☀️ {day.morning}<br/>
                          🌤️ {day.afternoon}<br/>
                          🌙 {day.evening}
                        </div>
                        {day.tips&&<div style={{fontSize:11,color:C.t3,marginTop:3,fontStyle:"italic"}}>💡 {day.tips}</div>}
                      </div>
                    ))}
                    {(trip.itinerary||[]).length>3&&(
                      <div style={{fontSize:12,color:C.accent}}>+{trip.itinerary.length-3} more days in full plan</div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{padding:"14px 18px",display:"flex",gap:8}}>
                    <button onClick={()=>veto(trip.id)} style={{flex:1,padding:"10px",borderRadius:12,border:"1px solid "+(vetoed?C.red:C.border),background:vetoed?"rgba(239,68,68,.12)":"none",color:vetoed?C.red:C.t2,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                      {vetoed?"Unveto ↩️":"❌ Hard veto"}
                    </button>
                    <button onClick={()=>vote(trip.id)} style={{flex:1,padding:"10px",borderRadius:12,border:"1px solid "+(voted?C.accent:C.border),background:voted?C.accentDim:"none",color:voted?C.accent:C.t2,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                      {voted?"Voted ❤️":"Vote ❤️"}
                    </button>
                    <button onClick={()=>saveToPlan(trip)} style={{flex:1,padding:"10px",borderRadius:12,background:C.accent,color:"white",border:"none",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                      Pick this
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{padding:"0 20px 40px"}}>
            <button className="bs" onClick={()=>{setStep(0);setTrips(null);setVetoes({});setVotes({});}}>
              ↺ Generate different options
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePlanFlow({onBack,groups,updateGroup,um,toast,defaultGroupId,push,savePlanToServer}){
  // ── Draft persistence: load saved progress on mount ──────
  const DRAFT_KEY="reach_plan_draft";
  // SSR-safe localStorage helpers — only run in browser
  const isBrowser=typeof window!=="undefined";
  const loadDraft=()=>{if(!isBrowser)return null;try{const d=window.localStorage.getItem(DRAFT_KEY);return d?JSON.parse(d):null;}catch{return null;}};
  const saveDraft=(state)=>{if(!isBrowser)return;try{window.localStorage.setItem(DRAFT_KEY,JSON.stringify(state));}catch{}};
  const clearDraft=()=>{if(!isBrowser)return;try{window.localStorage.removeItem(DRAFT_KEY);}catch{}};

  // Initialize state without calling localStorage at module level
  const [step,setStep]=useState(0);
  const [gid,setGid]=useState(defaultGroupId||null);
  const [planName,setPlanName]=useState("");
  const [planType,setPlanType]=useState(null);
  const [eventDate,setEventDate]=useState("");
  const [eventTime,setEventTime]=useState("");
  const [startDate,setStartDate]=useState("");
  const [endDate,setEndDate]=useState("");
  const [vibe,setVibe]=useState(null);
  const [dest,setDest]=useState(null);
  const [cuisine,setCuisine]=useState(null);
  const [concertGenre,setConcertGenre]=useState(null);
  const [accom,setAccom]=useState(null);
  const [bks,setBks]=useState([]);
  const [budget,setBudget]=useState("");
  const [voting,setVoting]=useState(false);
  const [vopts,setVopts]=useState(["",""]);
  const [draftLoaded,setDraftLoaded]=useState(false);

  // Load draft after mount (browser only)
  useEffect(()=>{
    if(draftLoaded)return;
    const draft=loadDraft();
    if(draft&&(draft.planType||draft.gid)){
      if(draft.step)setStep(draft.step);
      if(draft.gid&&!defaultGroupId)setGid(draft.gid);
      if(draft.planName)setPlanName(draft.planName);
      if(draft.planType)setPlanType(draft.planType);
      if(draft.eventDate)setEventDate(draft.eventDate);
      if(draft.eventTime)setEventTime(draft.eventTime);
      if(draft.startDate)setStartDate(draft.startDate);
      if(draft.endDate)setEndDate(draft.endDate);
      if(draft.vibe)setVibe(draft.vibe);
      if(draft.dest)setDest(draft.dest);
      if(draft.cuisine)setCuisine(draft.cuisine);
      if(draft.concertGenre)setConcertGenre(draft.concertGenre);
      if(draft.accom)setAccom(draft.accom);
      if(draft.bks)setBks(draft.bks);
      if(draft.budget)setBudget(draft.budget);
      if(draft.voting!==undefined)setVoting(draft.voting);
      if(draft.vopts)setVopts(draft.vopts);
    }
    setDraftLoaded(true);
  },[]);
  const [aiRecs,setAiRecs]=useState([]);
  const [loadingRecs,setLoadingRecs]=useState(false);
  const [showExitConfirm,setShowExitConfirm]=useState(false);
  const selGroup=groups.find(g=>g.id===gid);

  // Auto-save draft whenever state changes
  useEffect(()=>{
    if(!planType&&!gid)return; // nothing to save yet
    saveDraft({step,gid,planName,planType,eventDate,eventTime,startDate,endDate,vibe,dest,cuisine,concertGenre,accom,bks,budget,voting,vopts});
  },[step,gid,planName,planType,eventDate,eventTime,startDate,endDate,vibe,dest,cuisine,concertGenre,accom,bks,budget,voting,vopts]);

  const hasDraftProgress=!!(planType||gid);

  const handleBack=()=>{
    if(hasDraftProgress&&step>0){
      setShowExitConfirm(true);
    } else if(hasDraftProgress&&step===0){
      setShowExitConfirm(true);
    } else {
      clearDraft();
      onBack();
    }
  };

  // ── Type config: controls which steps show and what they say ─
  const isEvent=planType==="restaurant"||planType==="concert";
  const isWeekend=planType==="weekend";
  const isTrip=planType==="trip";

  // Steps adapt based on plan type
  const STEPS=planType==="restaurant"
    ? ["Type","When","Cuisine","Budget"]
    : planType==="concert"
    ? ["Type","When","Genre","Budget"]
    : planType==="weekend"
    ? ["Type","When","Vibe","Stay","Budget"]
    : ["Type","When","Vibe","Stay","Rules","Budget"]; // trip

  const nights=()=>{
    if(isEvent)return 0;
    if(!startDate||!endDate)return 0;
    return Math.max(0,(new Date(endDate)-new Date(startDate))/86400000);
  };

  const getDurationLabel=()=>{
    const n=nights();
    if(isEvent)return"Single event";
    if(n===0)return"Select dates";
    if(n===1)return"1 night";
    if(n<=3)return`${n} nights · Weekend`;
    if(n<=7)return`${n} nights · Week trip`;
    return`${n} nights · Extended trip`;
  };

  const getDefaultBudget=()=>{
    if(planType==="restaurant")return"150";
    if(planType==="concert")return"200";
    if(planType==="weekend")return"500";
    if(nights()<=3)return"800";
    if(nights()<=7)return"2000";
    return"3500";
  };

  const getBudgetPresets=()=>{
    if(planType==="restaurant")return["50","100","150","300"];
    if(planType==="concert")return["100","200","350","500"];
    if(planType==="weekend")return["300","500","800","1500"];
    return["1000","2000","3500","5000"];
  };

  const getBudgetLabel=()=>{
    if(planType==="restaurant")return"per person, dinner & drinks";
    if(planType==="concert")return"per person, tickets & transport";
    if(planType==="weekend")return"per person, all-in";
    return"per person, everything included";
  };

  const canContinue=()=>{
    const label=STEPS[step];
    if(label==="Type")return !!(gid&&planType);
    if(label==="When"){
      if(isEvent)return !!(eventDate);
      return !!(startDate&&endDate&&nights()>0);
    }
    if(label==="Cuisine"||label==="Genre"||label==="Vibe"||label==="Details")return true;
    if(label==="Stay")return !!(accom);
    if(label==="Rules")return true;
    if(label==="Budget")return !!(budget);
    return true;
  };

  const DBS=["Cold weather","Extreme heat","Crowds","Long flights","Hiking","Nightlife","Spicy food","Early starts","Camping","Loud venues","Outdoor dining"];

  // Auto-set budget when type is selected
  useEffect(()=>{
    if(planType&&!budget)setBudget(getDefaultBudget());
  },[planType,startDate,endDate]);

  // Load AI recs when vibe+dest+budget are set (trips only)
  useEffect(()=>{
    if(!isTrip||!vibe||!dest||!budget)return;
    const timer=setTimeout(async()=>{
      try{
        setLoadingRecs(true);
        const res=await fetch("/api/recommendations",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({vibe,destStyle:dest,accommodation:accom,dealbreakers:bks,budget:parseInt(budget),nights:nights(),travelers:selGroup?.memberIds?.length||2}),
        });
        if(res.ok){const {recommendations}=await res.json();setAiRecs(recommendations||[]);}
      }catch(e){}finally{setLoadingRecs(false);}
    },800);
    return()=>clearTimeout(timer);
  },[vibe,dest,budget,accom]);

  const finish=()=>{
    if(!gid)return;
    const dateRange=isEvent
      ?`${eventDate}${eventTime?" at "+eventTime:""}`
      :`${startDate} – ${endDate}`;
    const np={
      id:"p"+Date.now(),
      title:planName||(planType==="restaurant"?"Dinner out":planType==="concert"?"Concert Night":planType==="weekend"?"Weekend Away":selGroup?.name+" Trip"),
      status:voting?"voting":"planning",
      dates:dateRange,
      budget:parseInt(budget)||0,
      type:planType||"trip",
      participants:selGroup?.memberIds||[],
      itinerary:[],
      votes:voting?Object.fromEntries(vopts.filter(Boolean).map(o=>[o,0])):{},
      options:voting?vopts.filter(Boolean):[],
    };
    updateGroup(gid,g=>({...g,plans:[...g.plans,np],lastActivity:`Planning: ${np.title}`}));
    toast("Plan created! 🎉");
    clearDraft();
    if(typeof savePlanToServer==="function")savePlanToServer(gid,np);
    onBack();
  };

  // ── Cuisine options for restaurants ─────────────────────────
  const CUISINES=[
    {id:"italian",e:"🍝",l:"Italian"},{id:"japanese",e:"🍣",l:"Japanese"},
    {id:"mexican",e:"🌮",l:"Mexican"},{id:"american",e:"🍔",l:"American"},
    {id:"seafood",e:"🦞",l:"Seafood"},{id:"steakhouse",e:"🥩",l:"Steakhouse"},
    {id:"indian",e:"🍛",l:"Indian"},{id:"any",e:"🍽️",l:"Surprise us"},
  ];

  // ── Concert genres ───────────────────────────────────────────
  const GENRES=[
    {id:"pop",e:"🎤",l:"Pop / R&B"},{id:"rock",e:"🎸",l:"Rock / Indie"},
    {id:"hiphop",e:"🎧",l:"Hip-Hop"},{id:"edm",e:"🎛️",l:"EDM / Dance"},
    {id:"jazz",e:"🎷",l:"Jazz / Soul"},{id:"country",e:"🤠",l:"Country"},
    {id:"classical",e:"🎻",l:"Classical"},{id:"any",e:"🎵",l:"Any genre"},
  ];

  return(
    <div className="sc">
      {/* Exit confirmation sheet */}
      {showExitConfirm&&(
        <div className="ov" onClick={()=>setShowExitConfirm(false)}>
          <div className="sh" onClick={e=>e.stopPropagation()}>
            <div className="sh-hdl"/>
            <div style={{padding:"20px 20px 10px",textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:10}}>💾</div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1,marginBottom:8}}>Save your progress?</div>
              <div style={{fontSize:14,color:C.t2,lineHeight:1.6,marginBottom:20}}>Your plan is saved as a draft. You can pick up exactly where you left off.</div>
              <div style={{display:"flex",flexDirection:"column",gap:10,padding:"0 0 20px"}}>
                <button className="bp" onClick={()=>{setShowExitConfirm(false);toast("Draft saved — pick up where you left off anytime");onBack();}}>Save draft & exit</button>
                <button className="bs" style={{color:C.red,borderColor:C.red}} onClick={()=>{clearDraft();setShowExitConfirm(false);onBack();}}>Discard and exit</button>
                <button style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",padding:"8px 0"}} onClick={()=>setShowExitConfirm(false)}>Keep planning</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div style={{padding:"12px 20px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
          <button onClick={handleBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",fontFamily:"'Space Grotesk',sans-serif",fontSize:13,alignItems:"center"}}><Ic.ChevL/></button>
          <div style={{flex:1}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em"}}>{STEPS[step]}</div>
              <div style={{fontSize:11,color:C.t3}}>{step+1} / {STEPS.length}</div>
            </div>
            <div style={{display:"flex",gap:3,marginBottom:2}}>
              {STEPS.map((_,i)=><div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=step?C.accent:C.s3,transition:"background .3s"}}/>)}
            </div>
          </div>
        </div>
        {planType&&(
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0 2px"}}>
            <span style={{fontSize:16}}>{planType==="restaurant"?"🍽️":planType==="concert"?"🎵":planType==="weekend"?"🏡":"✈️"}</span>
            <span style={{fontSize:12,color:C.accent,fontWeight:600}}>{planType==="restaurant"?"Dinner out":planType==="concert"?"Concert":planType==="weekend"?"Weekend away":"Trip"}</span>
            {!isEvent&&nights()>0&&<span style={{fontSize:12,color:C.t3}}>· {getDurationLabel()}</span>}
            {isEvent&&eventDate&&<span style={{fontSize:12,color:C.t3}}>· {eventDate}</span>}
          </div>
        )}
      </div>
      <div style={{padding:"0 20px"}}>

        {step===0&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Who's joining?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Select a group and what you're planning.</div>
            <input className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Plan name (e.g., Summer Beach Trip)" style={{marginBottom:14}}/>
            <div className="sl" style={{marginBottom:10}}>Select a group</div>
            {groups.map(g=>(
              <div key={g.id} onClick={()=>setGid(g.id)} style={{display:"flex",alignItems:"center",gap:12,padding:13,borderRadius:14,border:`2px solid ${gid===g.id?C.accent:C.border}`,background:gid===g.id?C.accentDim:C.s2,marginBottom:8,cursor:"pointer"}}>
                <span style={{fontSize:22}}>{g.emoji}</span>
                <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.t1}}>{g.name}</div><div style={{fontSize:12,color:C.t2}}>{g.memberIds.length} members</div></div>
                {gid===g.id&&<div style={{color:C.accent}}><Ic.Check/></div>}
              </div>
            ))}
            <div className="sl" style={{margin:"14px 0 10px"}}>What are you planning?</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{id:"trip",e:"✈️",l:"Trip"},{id:"restaurant",e:"🍽️",l:"Dinner out"},{id:"concert",e:"🎵",l:"Concert"},{id:"weekend",e:"🏡",l:"Weekend Away"}].map(t=>(
                <button key={t.id} onClick={()=>setPlanType(t.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${planType===t.id?C.accent:C.border}`,background:planType===t.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
                  <div style={{fontSize:26,marginBottom:6}}>{t.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{t.l}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step===1&&(
          <div>
            {isEvent?(
              <>
                <div className="pt" style={{marginBottom:6}}>When is it?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>
                  {planType==="restaurant"?"Pick the date and time for your dinner.":"Pick the date for the concert or event."}
                </div>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Date</div>
                  <input type="date" className="inp" value={eventDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setEventDate(e.target.value)} style={{color:C.t1}}/>
                </div>
                {planType==="restaurant"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Reservation time (optional)</div>
                    <input type="time" className="inp" value={eventTime} onChange={e=>setEventTime(e.target.value)} style={{color:C.t1}}/>
                  </div>
                )}
                {planType==="concert"&&(
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:C.t2,marginBottom:8}}>Do you already have a specific event in mind?</div>
                    <input className="inp" value={planName} onChange={e=>setPlanName(e.target.value)} placeholder="Artist or event name (optional)" style={{marginBottom:8}}/>
                  </div>
                )}
                {eventDate&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",textAlign:"center",marginBottom:14}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>
                      {new Date(eventDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                    </div>
                    {eventTime&&<div style={{fontSize:13,color:C.accent,marginTop:4}}>{eventTime}</div>}
                  </div>
                )}
              </>
            ):(
              <>
                <div className="pt" style={{marginBottom:6}}>When?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>
                  {isWeekend?"Pick your weekend getaway dates.":"Everyone's availability is checked automatically."}
                </div>
                {isWeekend&&(
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {["This weekend","Next weekend","In 2 weeks","In a month"].map(preset=>(
                      <button key={preset} onClick={()=>{
                        const d=new Date();
                        const day=d.getDay();
                        const daysToFri=preset.includes("Next")?12-day:5-day<0?5-day+7:5-day;
                        const offset=preset.includes("2 weeks")?12:preset.includes("month")?26:daysToFri;
                        const fri=new Date(d.getTime()+offset*86400000);
                        const sun=new Date(fri.getTime()+2*86400000);
                        setStartDate(fri.toISOString().split("T")[0]);
                        setEndDate(sun.toISOString().split("T")[0]);
                      }} style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${C.border}`,background:C.s2,color:C.t2,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:10,marginBottom:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{isWeekend?"Friday":"Departure"}</div>
                    <input type="date" className="inp" value={startDate} min={new Date().toISOString().split("T")[0]} onChange={e=>setStartDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{isWeekend?"Sunday":"Return"}</div>
                    <input type="date" className="inp" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} style={{color:C.t1}}/>
                  </div>
                </div>
                {nights()>0&&(
                  <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:"12px 16px",marginBottom:14,textAlign:"center"}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1}}>{getDurationLabel()}</div>
                    <div style={{fontSize:12,color:C.t2,marginTop:2}}>{selGroup?.name} · {selGroup?.memberIds?.length||"?"} people</div>
                  </div>
                )}
              </>
            )}
            {selGroup&&(
              <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                <div style={{fontSize:12,color:C.t2,marginBottom:8}}><strong style={{color:C.t1}}>{isEvent?"Going with:":"Traveling with:"}</strong></div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {selGroup.memberIds.map(uid=>{const u=um[uid];return u?(<div key={uid} style={{display:"flex",alignItems:"center",gap:6,background:C.s3,borderRadius:20,padding:"4px 10px"}}><div className="av" style={{background:u.color,width:18,height:18,fontSize:9}}>{u.initials}</div><span style={{fontSize:12,color:C.t1}}>{u.name.split(" ")[0]}</span></div>):null;})}
                </div>
              </div>
            )}
          </div>
        )}

        {step===2&&(
          <div>
            {planType==="restaurant"?(
              <>
                <div className="pt" style={{marginBottom:6}}>What are you in the mood for?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Reach will find the best options for your group.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                  {CUISINES.map(c=>(
                    <button key={c.id} onClick={()=>setCuisine(c.id)} style={{padding:"14px 10px",borderRadius:14,border:`2px solid ${cuisine===c.id?C.accent:C.border}`,background:cuisine===c.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
                      <div style={{fontSize:24,marginBottom:4}}>{c.e}</div><div style={{fontSize:12,fontWeight:600,color:C.t1}}>{c.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:8}}>Atmosphere</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Casual & fun","Date night vibes","Special occasion","Lively & loud","Quiet & intimate"].map(a=>(
                    <button key={a} onClick={()=>setVibe(v=>v===a?null:a)} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${vibe===a?C.accent:C.border}`,background:vibe===a?C.accentDim:C.s2,color:vibe===a?C.accent:C.t2,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>{a}</button>
                  ))}
                </div>
              </>
            ):planType==="concert"?(
              <>
                <div className="pt" style={{marginBottom:6}}>What kind of show?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>This helps us find events your whole group will love.</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                  {GENRES.map(g=>(
                    <button key={g.id} onClick={()=>setConcertGenre(g.id)} style={{padding:"14px 10px",borderRadius:14,border:`2px solid ${concertGenre===g.id?C.accent:C.border}`,background:concertGenre===g.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
                      <div style={{fontSize:24,marginBottom:4}}>{g.e}</div><div style={{fontSize:12,fontWeight:600,color:C.t1}}>{g.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:8}}>Venue type</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {["Arena","Club / Bar","Outdoor festival","Intimate venue","Theater"].map(v=>(
                    <button key={v} onClick={()=>setDest(d=>d===v?null:v)} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${dest===v?C.accent:C.border}`,background:dest===v?C.accentDim:C.s2,color:dest===v?C.accent:C.t2,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>{v}</button>
                  ))}
                </div>
              </>
            ):(
              <>
                <div className="pt" style={{marginBottom:6}}>What's the vibe?</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:18}}>This shapes every AI recommendation.</div>
                <div className="sl" style={{marginBottom:10}}>Energy</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18}}>
                  {[{id:"chill",e:"🧘",l:"Chill & Relax"},{id:"active",e:"⚡",l:"High Energy"},{id:"culture",e:"🎭",l:"Culture & Arts"},{id:"mix",e:"🎲",l:"Mix It Up"}].map(v=>(
                    <button key={v.id} onClick={()=>setVibe(v.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${vibe===v.id?C.accent:C.border}`,background:vibe===v.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
                      <div style={{fontSize:28,marginBottom:6}}>{v.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{v.l}</div>
                    </button>
                  ))}
                </div>
                <div className="sl" style={{marginBottom:10}}>Destination style</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[{id:"city",e:"🏙️",l:"City"},{id:"beach",e:"🏖️",l:"Beach"},{id:"mountains",e:"🏔️",l:"Mountains"},{id:"nature",e:"🌿",l:"Nature"}].map(d=>(
                    <button key={d.id} onClick={()=>setDest(d.id)} style={{padding:"16px 12px",borderRadius:14,border:`2px solid ${dest===d.id?C.accent:C.border}`,background:dest===d.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
                      <div style={{fontSize:28,marginBottom:6}}>{d.e}</div><div style={{fontSize:13,fontWeight:600,color:C.t1}}>{d.l}</div>
                    </button>
                  ))}
                </div>
                {aiRecs.length>0&&(
                  <div style={{marginTop:16}}>
                    <div className="sl" style={{marginBottom:10}}>✨ AI picks for your group</div>
                    <div style={{display:"flex",gap:10,overflowX:"auto",scrollbarWidth:"none",paddingBottom:4}}>
                      {aiRecs.slice(0,3).map((r,i)=>(
                        <div key={i} style={{minWidth:160,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,flexShrink:0}}>
                          <div style={{fontSize:22,marginBottom:4}}>{r.emoji}</div>
                          <div style={{fontSize:13,fontWeight:600,color:C.t1,marginBottom:2}}>{r.title}</div>
                          <div style={{fontSize:11,color:C.t2,marginBottom:4}}>{r.price}</div>
                          <div style={{fontSize:11,color:C.t3,lineHeight:1.4}}>{r.reason}</div>
                        </div>
                      ))}
                      {loadingRecs&&<div style={{minWidth:120,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{fontSize:12,color:C.t3}}>Loading AI picks…</div></div>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step===3&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Where to stay?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Choose your preferred accommodation type.</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[{id:"hotel",e:"🏨",l:"Hotel",s:"Service & convenience"},{id:"rental",e:"🏡",l:"Vacation rental",s:"Space & flexibility"},{id:"luxury",e:"✨",l:"Luxury resort",s:"Premium all-inclusive"},{id:"boutique",e:"🎪",l:"Boutique / Unique",s:"One-of-a-kind stays"},{id:"hostel",e:"🎒",l:"Budget / Hostel",s:"Save money, meet people"}].map(a=>(
                <button key={a.id} onClick={()=>setAccom(a.id)} style={{padding:"14px 16px",borderRadius:14,border:`2px solid ${accom===a.id?C.accent:C.border}`,background:accom===a.id?C.accentDim:C.s2,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:14,fontFamily:"'Space Grotesk',sans-serif"}}>
                  <span style={{fontSize:26}}>{a.e}</span>
                  <div style={{flex:1}}><div style={{fontSize:14,fontWeight:600,color:C.t1}}>{a.l}</div><div style={{fontSize:12,color:C.t2}}>{a.s}</div></div>
                  {accom===a.id&&<div style={{color:C.accent}}><Ic.Check/></div>}
                </button>
              ))}
            </div>
          </div>
        )}

        {step===4&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>Any dealbreakers?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Reach won't recommend anything that crosses these lines.</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:18}}>
              {DBS.map(d=>{const sel=bks.includes(d);return(
                <button key={d} onClick={()=>setBks(b=>sel?b.filter(x=>x!==d):[...b,d])} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${sel?C.red:C.border}`,background:sel?C.redDim:C.s2,color:sel?C.red:C.t2,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
                  {sel?"✕ ":""}{d}
                </button>
              );})}
            </div>
            <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:12,color:C.t2}}><strong style={{color:C.t1}}>AI note:</strong> Reach asks all members for their dealbreakers. Only destinations that work for everyone will be recommended.</div>
            </div>
          </div>
        )}

        {step===5&&(
          <div>
            <div className="pt" style={{marginBottom:6}}>What's the budget?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>Maximum spend per person, everything included.</div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>
                {isEvent?"Typical cost for this":"AI cost estimate"}
              </div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.accent}}>
                {planType==="restaurant"?`$${Math.round(parseInt(budget||0)*.6).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :planType==="concert"?`$${Math.round(parseInt(budget||0)*.5).toLocaleString()} – $${parseInt(budget||0).toLocaleString()} pp`
                :`$${Math.round(parseInt(budget||0)*.7).toLocaleString()} – $${Math.round(parseInt(budget||0)*1.05).toLocaleString()}`}
              </div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>
                {isEvent
                  ?`${selGroup?.memberIds?.length||2} people · ${planType==="restaurant"?"dinner & drinks":"tickets & transport"}`
                  :`${selGroup?.memberIds?.length||2} travelers · ${nights()>0?nights()+" nights · ":""}${getBudgetLabel()}`
                }
              </div>
            </div>
            <div style={{background:C.s1,border:`2px solid ${C.accent}`,borderRadius:16,padding:"14px 20px",display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <span style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t3}}>$</span>
              <input style={{background:"none",border:"none",outline:"none",fontFamily:"'Instrument Serif',serif",fontSize:36,color:C.t1,width:"100%"}} value={budget} onChange={e=>setBudget(e.target.value.replace(/\D/g,""))} inputMode="numeric" placeholder="2500"/>
              <span style={{fontSize:12,color:C.t3}}>max</span>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:18}}>
              {getBudgetPresets().map(v=>(
                <button key={v} onClick={()=>setBudget(v)} style={{flex:1,padding:"8px 4px",borderRadius:10,border:`1px solid ${budget===v?C.accent:C.border}`,background:budget===v?C.accentDim:C.s2,color:budget===v?C.accent:C.t2,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>${parseInt(v).toLocaleString()}</button>
              ))}
            </div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:voting?12:0}}>
                <div><div style={{fontSize:14,fontWeight:500,color:C.t1}}>Enable destination voting</div><div style={{fontSize:12,color:C.t2,marginTop:2}}>Let the group vote on where to go</div></div>
                <button onClick={()=>setVoting(!voting)} style={{width:44,height:26,borderRadius:13,background:voting?C.accent:C.s3,border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                  <div style={{width:20,height:20,borderRadius:"50%",background:"white",position:"absolute",top:3,left:voting?21:3,transition:"left .2s"}}/>
                </button>
              </div>
              {voting&&vopts.map((opt,i)=>(
                <input key={i} className="inp" style={{fontSize:13,marginTop:8}} placeholder={`Option ${i+1} (e.g. Lisbon)`} value={opt} onChange={e=>setVopts(v=>v.map((x,j)=>j===i?e.target.value:x))}/>
              ))}
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:10,paddingTop:16,paddingBottom:30}}>
          {step>0&&<button className="bs" style={{flex:1}} onClick={()=>setStep(s=>s-1)}>← Back</button>}
          {step===0&&<button className="bs" style={{flex:1}} onClick={handleBack}>Cancel</button>}
          {step<STEPS.length-1
            ?<button className="bp" style={{flex:2}} disabled={!canContinue()} onClick={()=>setStep(s=>s+1)}>Continue →</button>
            :<button className="bp" style={{flex:2}} disabled={!budget} onClick={finish}>
              {planType==="restaurant"?"Plan dinner 🍽️"
              :planType==="concert"?"Plan this night 🎵"
              :planType==="weekend"?"Plan this weekend 🏡"
              :"Create trip 🎉"}
            </button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── PLAN DETAIL ──────────────────────────────────────────────────────────────
function PlanDetailScreen({onBack,planId,groupId,groups,um,updateGroup,push,toast,updatePlanOnServer,castVoteOnServer,refreshGroup}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  const [atab,setAtab]=useState("overview");
  const [myVote,setMyVote]=useState(null);
  const [loading,setLoading]=useState(false);

  // Fetch latest plan data on mount
  useEffect(()=>{
    if(!planId||!groupId)return;
    const fetchPlan=async()=>{
      try{
        const r=await fetch(`/api/plans/${planId}`);
        if(!r.ok)return;
        const data=await r.json();
        // Update vote tally from server
        if(data.votes)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:data.votes,myVote:data.myVote}:p)}));
        if(data.myVote)setMyVote(data.myVote);
        // Update itinerary
        if(data.itinerary)updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:data.itinerary.map(item=>({time:item.scheduled_time||"",title:item.title,sub:item.subtitle||"",type:item.type,conf:item.confirmation_number||null,filled:item.is_confirmed}))}:p)}));
      }catch(e){}
    };
    fetchPlan();
  },[planId]);

  if(!plan||!group)return null;
  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const totalV=Object.values(plan.votes||{}).reduce((a,b)=>a+b,0);

  const castVote=async opt=>{
    if(myVote)return;
    setMyVote(opt);
    // Optimistic update
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,votes:{...p.votes,[opt]:(p.votes[opt]||0)+1}}:p)}));
    toast(`Voted for ${opt}!`);
    // Server sync
    if(castVoteOnServer)await castVoteOnServer(planId,opt);
  };

  const updateStatus=async(newStatus)=>{
    setLoading(true);
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:newStatus}:p)}));
    if(updatePlanOnServer)await updatePlanOnServer(planId,{status:newStatus});
    setLoading(false);
  };
  const tabs=["overview","itinerary",plan.options.length>0?"vote":null,"budget"].filter(Boolean);

  return(
    <div className="sc" style={{paddingBottom:0}}>
      <div style={{background:"linear-gradient(145deg,#1a1060,#6C63FF)",padding:"18px 20px 22px",flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <button onClick={onBack} style={{background:"rgba(0,0,0,.3)",border:"none",cursor:"pointer",borderRadius:"50%",width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",color:"white"}}><Ic.ChevL/></button>
          <button className="bsm" style={{background:"rgba(255,255,255,.15)",color:"white",border:"none"}} onClick={()=>push("editItinerary",{planId,groupId})}>Edit plan</button>
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:"white",marginBottom:4}}>{plan.title}</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginBottom:12}}>{plan.dates} · {group.name}</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <span className={`pill ${plan.status==="booked"?"pill-g":plan.status==="voting"?"pill-a":"pill-p"}`}>{plan.status==="booked"?"✓ Booked":plan.status==="voting"?"⏳ Voting":plan.status==="approved"?"✅ Approved":"📋 Planning"}</span>
          <span className="pill" style={{background:"rgba(255,255,255,.15)",color:"white"}}>${plan.budget}/person</span>
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.s1,flexShrink:0}}>
        {tabs.map(t=>(
          <button key={t} onClick={()=>setAtab(t)} style={{flex:1,padding:"11px 0",background:"none",border:"none",borderBottom:`2px solid ${atab===t?C.accent:"transparent"}`,color:atab===t?C.accent:C.t2,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",paddingBottom:20}}>
        {atab==="overview"&&(
          <div style={{padding:"16px 0"}}>
            <div style={{display:"flex",gap:10,padding:"0 20px 14px"}}>
              {[{l:"Travelers",v:plan.participants.length,e:"👥"},{l:"Budget",v:`$${plan.budget}`,e:"💳"},{l:"Nights",v:"~"+(plan.dates.includes("–")?7:"?"),e:"🌙"}].map((s,i)=>(
                <div key={i} style={{flex:1,background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:12,textAlign:"center"}}>
                  <div style={{fontSize:20}}>{s.e}</div>
                  <div style={{fontFamily:"'Instrument Serif',serif",fontSize:18,color:C.t1,marginTop:4}}>{s.v}</div>
                  <div style={{fontSize:10,color:C.t3,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                </div>
              ))}
            </div>
            <div style={{padding:"0 20px 14px"}}>
              <div className="sl" style={{marginBottom:10}}>Who's coming</div>
              {plan.participants.map(uid=>{const u=um[uid];return u?(
                <div key={uid} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                  <div className="av-lg" style={{background:u.color}}>{u.initials}</div>
                  <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{u.name}</div><div style={{fontSize:12,color:C.t2}}>{u.handle}</div></div>
                  <span className="pill pill-g" style={{fontSize:10}}>✓ In</span>
                </div>
              ):null;})}
            </div>
            {plan.itinerary.length>0&&(
              <div style={{padding:"0 20px 14px"}}>
                <div className="sl" style={{marginBottom:10}}>Bookings</div>
                <div style={{background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontSize:13,color:C.t1}}>Confirmed</span>
                    <span style={{fontSize:13,color:C.green,fontWeight:600}}>{plan.itinerary.filter(i=>i.conf).length}/{plan.itinerary.length}</span>
                  </div>
                  <div className="pb-t"><div className="pb-f" style={{width:`${(plan.itinerary.filter(i=>i.conf).length/Math.max(plan.itinerary.length,1))*100}%`,background:C.green}}/></div>
                </div>
              </div>
            )}
            <div style={{padding:"0 20px"}}>
              {plan.status==="planning"&&<button className="bp" style={{marginBottom:10}} onClick={()=>{updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:"voting"}:p)}));setAtab("vote");toast("Sent to the group for a vote!");}}>Send to group for a vote</button>}
              {plan.status==="voting"&&<button className="bp" style={{marginBottom:10}} onClick={()=>{updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:"approved"}:p)}));toast("Plan approved!");}}>Approve and proceed to booking</button>}
              {plan.status==="approved"&&<button className="bp" style={{marginBottom:10,background:C.green}} onClick={()=>push("checkout",{planId,groupId})}>Book Everything →</button>}
              {plan.status==="booked"&&<button className="bp" style={{marginBottom:10}} onClick={()=>setAtab("itinerary")}>View Itinerary</button>}
              <button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>Edit plan details</button>
            </div>
          </div>
        )}
        {atab==="itinerary"&&(
          <div style={{padding:"12px 0"}}>
            {plan.itinerary.length===0?(
              <div style={{padding:"40px 20px",textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:12}}>📋</div>
                <div style={{fontSize:16,fontWeight:600,color:C.t1,marginBottom:6}}>No itinerary yet</div>
                <div style={{fontSize:13,color:C.t2,marginBottom:20}}>Add flights, hotels, activities, restaurants, and more.</div>
                <button className="bp" onClick={()=>push("editItinerary",{planId,groupId})}>Build Itinerary</button>
              </div>
            ):(
              <>
                {plan.itinerary.map((item,i)=>(
                  <div key={i} className="it-item">
                    <div className="it-time">{item.time}</div>
                    <div className="it-lc">
                      <div className={`it-dot ${item.filled?"fi":""}`}/>
                      {i<plan.itinerary.length-1&&<div className="it-cn"/>}
                    </div>
                    <div className="it-cont">
                      <div style={{display:"flex",alignItems:"center",gap:6}}><span>{tIc[item.type]||"📌"}</span><div className="it-tt">{item.title}</div></div>
                      <div className="it-sb">{item.sub}</div>
                      {item.conf&&<div className="it-cf">✓ Confirmed · {item.conf}</div>}
                    </div>
                  </div>
                ))}
                <div style={{padding:"14px 20px"}}><button className="bs" onClick={()=>push("editItinerary",{planId,groupId})}>+ Add or Edit Items</button></div>
              </>
            )}
          </div>
        )}
        {atab==="vote"&&plan.options.length>0&&(
          <div style={{padding:"16px 20px"}}>
            <div className="pt" style={{fontSize:22,marginBottom:6}}>Where should we go?</div>
            <div style={{fontSize:13,color:C.t2,marginBottom:18}}>{totalV} of {plan.participants.length} voted.</div>
            {plan.options.map(opt=>{
              const v=plan.votes[opt]||0; const pct=totalV>0?(v/totalV)*100:0; const mine=myVote===opt;
              return(
                <div key={opt} onClick={()=>castVote(opt)} style={{background:mine?C.accentDim:C.s2,border:`2px solid ${mine?C.accent:C.border}`,borderRadius:16,padding:16,marginBottom:10,cursor:myVote?"default":"pointer",transition:"all .15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:20,color:C.t1}}>{opt}</div>
                    <div style={{fontSize:13,fontWeight:600,color:mine?C.accent:C.t2}}>{v} vote{v!==1?"s":""}</div>
                  </div>
                  <div className="pb-t" style={{marginBottom:8}}><div className="pb-f" style={{width:`${pct}%`}}/></div>
                  {!myVote&&<div style={{fontSize:12,color:C.accent,fontWeight:500}}>Tap to vote →</div>}
                  {mine&&<div style={{fontSize:12,color:C.accent,fontWeight:500}}>✓ Your vote</div>}
                </div>
              );
            })}
            {myVote&&<div style={{background:C.greenDim,border:`1px solid ${C.green}`,borderRadius:14,padding:14,textAlign:"center",marginTop:8}}><div style={{fontSize:13,color:C.green,fontWeight:500}}>Your vote has been recorded. Results update in real time.</div></div>}
          </div>
        )}
        {atab==="budget"&&(
          <div style={{padding:"16px 20px"}}>
            <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:20,padding:20,marginBottom:18,textAlign:"center"}}>
              <div style={{fontSize:12,color:C.accent,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>Budget per person</div>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:44,color:C.t1}}>${plan.budget.toLocaleString()}</div>
              <div style={{fontSize:12,color:C.t2,marginTop:4}}>{plan.participants.length} travelers total</div>
            </div>
            {[{l:"Flights (est.)",a:"$480–$720",p:28},{l:"Accommodation",a:"$600–$900",p:34},{l:"Activities",a:"$200–$400",p:13},{l:"Food & dining",a:"$300–$500",p:18},{l:"Transport",a:"$80–$150",p:5},{l:"Buffer",a:"$50–$100",p:4}].map((r,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:13,color:C.t1}}>{r.l}</span><span style={{fontSize:13,color:C.t2}}>{r.a}</span></div>
                <div className="pb-t"><div className="pb-f" style={{width:`${r.p}%`}}/></div>
              </div>
            ))}
            <div style={{height:1,background:C.border,margin:"14px 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:14,color:C.t1,fontWeight:600}}>Total estimate</span>
              <span style={{fontSize:14,color:C.green,fontWeight:600}}>${(plan.budget*.8).toFixed(0)} – ${plan.budget.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EDIT ITINERARY ───────────────────────────────────────────────────────────
function EditItineraryScreen({onBack,planId,groupId,groups,updateGroup,toast,saveItineraryToServer}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  const [items,setItems]=useState(plan?.itinerary||[]);
  const [adding,setAdding]=useState(false);
  const [ni,setNi]=useState({time:"",title:"",sub:"",type:"activity",conf:""});
  if(!plan)return null;
  const tIc={flight:"✈️",hotel:"🏨",activity:"🎯",restaurant:"🍽️",transport:"🚗"};
  const addItem=()=>{if(!ni.title)return;setItems(p=>[...p,{...ni,filled:!!ni.conf}]);setNi({time:"",title:"",sub:"",type:"activity",conf:""});setAdding(false);};
  const rm=idx=>setItems(p=>p.filter((_,i)=>i!==idx));
  const save=async()=>{
    updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,itinerary:items}:p)}));
    toast("Itinerary saved");
    if(saveItineraryToServer)await saveItineraryToServer(planId,items);
    onBack();
  };
  return(
    <div className="sc">
      <div style={{padding:"12px 20px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Back</button>
          <button className="bsm bsm-p" onClick={save}>Save</button>
        </div>
        <div className="pt" style={{fontSize:24,marginTop:12}}>Edit Itinerary</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>{plan.title}</div>
      </div>
      {items.map((item,i)=>(
        <div key={i} style={{margin:"0 20px 8px",background:C.s2,borderRadius:14,padding:14,border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{display:"flex",gap:10,flex:1}}>
              <span style={{fontSize:20}}>{tIc[item.type]||"📌"}</span>
              <div>
                <div style={{fontSize:14,fontWeight:500,color:C.t1}}>{item.title}</div>
                <div style={{fontSize:12,color:C.t2}}>{item.time}{item.sub?` · ${item.sub}`:""}</div>
                {item.conf&&<div style={{fontSize:11,color:C.green,marginTop:2}}>✓ {item.conf}</div>}
              </div>
            </div>
            <button onClick={()=>rm(i)} style={{background:"none",border:"none",cursor:"pointer",color:C.red,padding:4}}><Ic.Trash/></button>
          </div>
        </div>
      ))}
      {adding?(
        <div style={{margin:"0 20px 12px",background:C.s2,borderRadius:16,padding:16,border:`1px solid ${C.accentBorder}`}}>
          <div className="sl" style={{marginBottom:12}}>New item</div>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {Object.entries(tIc).map(([type,icon])=>(
              <button key={type} onClick={()=>setNi(n=>({...n,type}))} style={{padding:"6px 10px",borderRadius:10,border:`1.5px solid ${ni.type===type?C.accent:C.border}`,background:ni.type===type?C.accentDim:C.s3,cursor:"pointer",fontSize:12,fontFamily:"'Space Grotesk',sans-serif",color:C.t1}}>{icon} {type}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input className="inp" style={{width:88,fontSize:13}} placeholder="Time / Day" value={ni.time} onChange={e=>setNi(n=>({...n,time:e.target.value}))}/>
            <input className="inp" style={{flex:1,fontSize:13}} placeholder="Title (required)" value={ni.title} onChange={e=>setNi(n=>({...n,title:e.target.value}))}/>
          </div>
          <input className="inp" style={{marginBottom:8,fontSize:13}} placeholder="Details or location" value={ni.sub} onChange={e=>setNi(n=>({...n,sub:e.target.value}))}/>
          <input className="inp" style={{marginBottom:12,fontSize:13}} placeholder="Confirmation number (if booked)" value={ni.conf} onChange={e=>setNi(n=>({...n,conf:e.target.value}))}/>
          <div style={{display:"flex",gap:8}}>
            <button className="bsm bsm-p" style={{flex:1}} onClick={addItem} disabled={!ni.title}>Add item</button>
            <button className="bsm bsm-g" style={{flex:1}} onClick={()=>setAdding(false)}>Cancel</button>
          </div>
        </div>
      ):(
        <div style={{padding:"8px 20px 14px"}}><button className="bs" onClick={()=>setAdding(true)}>+ Add flight, hotel, activity, or restaurant…</button></div>
      )}
      <div style={{padding:"0 20px 30px"}}><button className="bp" onClick={save}>Save Itinerary</button></div>
    </div>
  );
}

// ─── CHECKOUT ─────────────────────────────────────────────────────────────────

// ============ CHECKOUT V2 — real propose -> fund -> approve ============
function CheckoutScreenV2({onBack,planId,groupId,groups,updateGroup,toast}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans?.find(p=>p.id===planId);
  // phases: loading | review | pay | approving | waiting | priceUp | done | error
  const [phase,setPhase]=useState("loading");
  const [funding,setFunding]=useState(null);
  const [bookings,setBookings]=useState([]);
  const [clientSecret,setClientSecret]=useState(null);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  const [payReady,setPayReady]=useState(false);
  const stripeRef=useRef(null); const elementsRef=useRef(null); const payRef=useRef(null);

  const fmt=c=>"$"+((c||0)/100).toLocaleString(undefined,{maximumFractionDigits:0});
  const participants=plan?.participants?.length||1;
  const targetCents=funding?.targetCents||0;
  const myShareCents=targetCents>0?Math.ceil(targetCents/participants):Math.round((plan?.budget||0)*100);
  const vIcon={flight:"\u2708\uFE0F",hotel:"\uD83C\uDFE8",activity:"\uD83C\uDFAF",event:"\uD83C\uDFDF\uFE0F",restaurant:"\uD83C\uDF7D\uFE0F"};

  const load=async()=>{
    try{
      const [fRes,bRes]=await Promise.all([
        fetch(`/api/plans/${planId}/funding`),
        fetch(`/api/bookings?planId=${planId}`)
      ]);
      const f=fRes.ok?await fRes.json():null;
      const bJson=bRes.ok?await bRes.json():null;
      setFunding(f);
      setBookings((bJson&&(bJson.bookings||bJson))||[]);
      setPhase("review");
    }catch(e){ setMsg("Couldn't load your trip \u2014 check your connection and try again."); setPhase("error"); }
  };
  useEffect(()=>{ load(); },[]);

  const startPayment=async()=>{
    if(busy)return; setBusy(true);
    try{
      const r=await fetch(`/api/plans/${planId}/funding`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amountCents:myShareCents})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.clientSecret)throw new Error(d.error||"Couldn't start the payment \u2014 try again.");
      setClientSecret(d.clientSecret); setPhase("pay");
    }catch(e){ toast(e.message); }
    setBusy(false);
  };

  useEffect(()=>{
    if(phase!=="pay"||!clientSecret)return;
    const pk=process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if(!pk){ setMsg("Payments aren't switched on yet for this build."); setPhase("error"); return; }
    const boot=()=>{
      try{
        const stripe=window.Stripe(pk);
        const elements=stripe.elements({clientSecret,appearance:{theme:"night",variables:{colorPrimary:"#D4AF37",borderRadius:"12px"}}});
        const pe=elements.create("payment");
        pe.on("ready",()=>setPayReady(true));
        pe.mount(payRef.current);
        stripeRef.current=stripe; elementsRef.current=elements;
      }catch(e){ setMsg("Payment form couldn't load \u2014 try again."); setPhase("error"); }
    };
    if(window.Stripe){boot();}
    else{ const s=document.createElement("script"); s.src="https://js.stripe.com/v3"; s.onload=boot; s.onerror=()=>{setMsg("Payment form couldn't load \u2014 check your connection.");setPhase("error");}; document.head.appendChild(s); }
  },[phase,clientSecret]);

  const confirmPay=async()=>{
    if(busy||!stripeRef.current)return; setBusy(true);
    try{
      const {error,paymentIntent}=await stripeRef.current.confirmPayment({elements:elementsRef.current,redirect:"if_required"});
      if(error)throw new Error(error.message||"Payment didn't go through.");
      await fetch(`/api/plans/${planId}/funding/confirm`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paymentIntentId:paymentIntent.id})});
      setBusy(false);
      await approveAll(false);
    }catch(e){ toast(e.message||"Payment didn't go through."); setBusy(false); }
  };

  const approveAll=async(acceptNewPrice)=>{
    setPhase("approving");
    let fresh=[];
    try{ const r=await fetch(`/api/bookings?planId=${planId}`); const j=await r.json(); fresh=(j&&(j.bookings||j))||[]; }catch(e){ fresh=bookings; }
    const waiting=(fresh||[]).filter(b=>b.status==="awaiting_approval");
    for(const b of waiting){
      try{
        const r=await fetch(`/api/bookings/${b.id}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(acceptNewPrice?{acceptNewPrice:true}:{})});
        if(r.status===402){ setPhase("waiting"); return; }
        if(r.status===409){ setPhase("priceUp"); return; }
      }catch(e){/* keep going; ops can PATCH later */}
    }
    setBookings(fresh);
    setPhase("done");
  };

  const chip=(label,tone)=>(<span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:.3,
    background:tone==="green"?"rgba(16,185,129,.15)":tone==="gold"?"rgba(212,175,55,.15)":"rgba(255,255,255,.08)",
    color:tone==="green"?C.green:tone==="gold"?"#D4AF37":C.t2}}>{label}</span>);

  const lines=(bookings&&bookings.length?bookings.map(b=>({
    icon:vIcon[b.vertical]||"\u2728", l:(b.detail&&(b.detail.title||b.detail.name))||b.vertical,
    d:b.provider==="concierge"?"We'll handle this one for you":(b.mode==="redirect"?"Opens in partner site":""),
    a:b.price_cents, st:b.status
  })):[
    {icon:"\u2708\uFE0F",l:"Round-trip flights",d:`${participants} travelers`,a:Math.round(myShareCents*.34*participants)},
    {icon:"\uD83C\uDFE8",l:"Accommodation",d:"",a:Math.round(myShareCents*.4*participants)},
    {icon:"\uD83C\uDFAF",l:"Activities & tours",d:"",a:Math.round(myShareCents*.26*participants)}
  ]);

  if(phase==="loading")return(<div className="sc"><div style={{padding:"60px 20px",textAlign:"center",color:C.t2}}>Getting your trip ready\u2026</div></div>);

  if(phase==="error")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:34,marginBottom:12}}>\uD83D\uDE48</div>
    <div style={{color:C.t1,fontWeight:600,marginBottom:8}}>{msg}</div>
    <button onClick={()=>{setPhase("loading");load();}} style={{marginTop:12,padding:"12px 24px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700}}>Try again</button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Go back</div>
  </div></div>);

  if(phase==="waiting")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>\uD83E\uDD1D</div>
    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:8}}>You're in!</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:16}}>A few people still need to chip in before we book. We'll lock everything in the moment the group is fully funded.</div>
    <div style={{margin:"0 auto 20px",maxWidth:260}}>{funding&&(()=>{const pct=Math.min(100,Math.round(((funding.collectedCents+myShareCents)/Math.max(funding.targetCents,1))*100));
      return(<div><div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:8,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:"linear-gradient(90deg,#D4AF37,#10B981)"}}/></div>
      <div style={{fontSize:12,color:C.t2,marginTop:6}}>{pct}% of the trip funded</div></div>);})()}</div>
    <button onClick={()=>toast("Reminder sent to the group \uD83D\uDC4B")} style={{padding:"12px 24px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700}}>Remind them?</button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Back to trip</div>
  </div></div>);

  if(phase==="priceUp")return(<div className="sc"><div style={{padding:"60px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:12}}>\uD83D\uDCC8</div>
    <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:8}}>Price went up a little</div>
    <div style={{color:C.t2,fontSize:14,lineHeight:1.5,marginBottom:20}}>One of your bookings costs a bit more than when we quoted it. Still book it?</div>
    <button disabled={busy} onClick={()=>approveAll(true)} style={{padding:"12px 24px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700,opacity:busy?.6:1}}>Yes, book it</button>
    <div onClick={onBack} style={{marginTop:14,color:C.t2,fontSize:13,cursor:"pointer"}}>Let me think</div>
  </div></div>);

  if(phase==="approving")return(<div className="sc"><div style={{padding:"80px 24px",textAlign:"center"}}>
    <div style={{fontSize:40,marginBottom:14}}>\u2728</div>
    <div style={{color:C.t1,fontWeight:600}}>Locking in your bookings\u2026</div>
    <div style={{color:C.t2,fontSize:13,marginTop:6}}>This takes a few seconds</div>
  </div></div>);

  if(phase==="done"){
    const confetti=Array.from({length:36},(_,i)=>i);
    return(<div className="sc" style={{paddingBottom:40,position:"relative",overflow:"hidden"}}>
      <style>{`@keyframes rfall{0%{transform:translateY(-20px) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(540deg);opacity:0}}`}</style>
      {confetti.map(i=>(<span key={i} style={{position:"absolute",left:(i*137)%100+"%",top:-10,width:8,height:12,borderRadius:2,
        background:["#D4AF37","#10B981","#60A5FA","#F472B6"][i%4],animation:`rfall ${2.2+(i%5)*.4}s ${(i%7)*.18}s ease-in forwards`,zIndex:5}}/>))}
      <div style={{background:"linear-gradient(145deg,#064E3B,#10B981)",padding:"48px 28px 36px",textAlign:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px"}}>\u2713</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:30,color:"white",marginBottom:6}}>You're all booked!</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.75)"}}>Powered by Stripe \u00B7 PCI-DSS compliant</div>
      </div>
      <div style={{padding:"20px 20px 0"}}>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Amount charged</span>
            <span style={{fontSize:13,color:C.t1,fontWeight:700}}>{fmt(myShareCents)}</span></div>
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Security</span>
            <span style={{fontSize:12,color:C.green,fontWeight:600}}>\uD83D\uDD12 Secured by Stripe</span></div>
        </div>
        <div style={{marginBottom:16}}>
          <div className="sl" style={{marginBottom:10}}>Your bookings</div>
          {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 4px"}}>
            <span style={{fontSize:20}}>{it.icon}</span>
            <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
              {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
            {chip(it.st==="confirmed"?"Booked \u2713":it.st==="pending"?"We're on it":"Booked \u2713",it.st==="pending"?"gold":"green")}
          </div>))}
        </div>
        <button onClick={onBack} style={{width:"100%",padding:"15px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700,fontSize:15}}>See my itinerary</button>
      </div>
    </div>);
  }

  if(phase==="pay")return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={()=>setPhase("review")} style={{cursor:"pointer",color:C.t2,fontSize:20}}>\u2190</span>
      <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>Your share \u00B7 {fmt(myShareCents)}</span>
    </div>
    <div style={{padding:"8px 20px 0"}}>
      <div ref={payRef} style={{minHeight:220,background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:14}}/>
      {!payReady&&<div style={{textAlign:"center",color:C.t2,fontSize:13,marginTop:10}}>Loading secure payment\u2026</div>}
      <button disabled={!payReady||busy} onClick={confirmPay}
        style={{width:"100%",marginTop:16,padding:"15px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700,fontSize:15,opacity:(!payReady||busy)?.6:1}}>
        {busy?"Paying\u2026":`Pay ${fmt(myShareCents)}`}</button>
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>\uD83D\uDD12 Secured by Stripe \u00B7 you only pay your share</div>
    </div>
  </div>);

  // phase === review
  return(<div className="sc" style={{paddingBottom:40}}>
    <div style={{padding:"18px 20px 6px",display:"flex",alignItems:"center",gap:10}}>
      <span onClick={onBack} style={{cursor:"pointer",color:C.t2,fontSize:20}}>\u2190</span>
      <span style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1}}>{plan?.destination||plan?.name||"Your trip"}</span>
    </div>
    <div style={{padding:"6px 20px 0"}}>
      <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:"6px 4px",marginBottom:14}}>
        {lines.map((it,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderBottom:i<lines.length-1?`1px solid ${C.border}`:"none"}}>
          <span style={{fontSize:20}}>{it.icon}</span>
          <div style={{flex:1}}><div style={{fontSize:14,color:C.t1,fontWeight:600}}>{it.l}</div>
            {it.d?<div style={{fontSize:12,color:C.t2}}>{it.d}</div>:null}</div>
          {it.st?chip(it.st==="awaiting_approval"?"Quoted":it.st==="confirmed"?"Booked \u2713":"We're on it",it.st==="confirmed"?"green":it.st==="awaiting_approval"?"":"gold"):null}
        </div>))}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"0 4px",marginBottom:16}}>
        <span style={{fontSize:14,color:C.t2}}>Your share ({participants} people)</span>
        <span style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1}}>{fmt(myShareCents)}</span>
      </div>
      <button disabled={busy} onClick={startPayment}
        style={{width:"100%",padding:"16px",borderRadius:14,border:"none",background:"#D4AF37",color:"#0B0B10",fontWeight:700,fontSize:16,opacity:busy?.6:1}}>
        {busy?"One sec\u2026":"Looks good"}</button>
      <div style={{textAlign:"center",fontSize:12,color:C.t2,marginTop:10}}>Nothing books until the whole group is in \uD83E\uDD1D</div>
    </div>
  </div>);
}
// ============ END CHECKOUT V2 ============

function CheckoutScreen({onBack,planId,groupId,groups,updateGroup,toast}){
  const group=groups.find(g=>g.id===groupId);
  const plan=group?.plans.find(p=>p.id===planId);
  // steps: 0=review, 1=split, 2=stripe, 3=mfa, 4=done
  const [step,setStep]=useState(0);
  const [splitMethod,setSplitMethod]=useState("personal"); // personal|wallet|split
  const [cardNum,setCardNum]=useState("");
  const [cardExp,setCardExp]=useState("");
  const [cardCvc,setCardCvc]=useState("");
  const [cardName,setCardName]=useState("");
  const [mfaCode,setMfaCode]=useState("");
  const [processing,setProcessing]=useState(false);
  const [useSaved,setUseSaved]=useState(true);

  if(!plan)return null;

  const perPerson=plan.budget;
  const total=perPerson*plan.participants.length;
  const lines=[
    {l:"Round-trip flights",d:`${plan.participants.length} travelers`,a:Math.round(perPerson*.28)},
    {l:"Accommodation",d:"7 nights",a:Math.round(perPerson*.34)},
    {l:"Activities & tours",d:"3 included",a:Math.round(perPerson*.13)},
    {l:"Restaurant reservations",d:"4 dinners",a:0},
    {l:"Ground transport",d:"Airport transfers",a:Math.round(perPerson*.05)},
    {l:"Reach service fee",d:"2% of booking",a:Math.round(perPerson*.02)},
  ];

  const fmtCard=v=>v.replace(/\D/g,"").slice(0,16).replace(/(.{4})/g,"$1 ").trim();
  const fmtExp=v=>{const d=v.replace(/\D/g,"").slice(0,4);return d.length>2?d.slice(0,2)+"/"+d.slice(2):d;};

  const handleStripeSubmit=()=>{
    if(useSaved||((cardNum.replace(/\s/g,"").length===16)&&cardExp.length===5&&cardCvc.length===3&&cardName)){
      setProcessing(true);
      setTimeout(()=>{setProcessing(false);setStep(3);},1800);
    }
  };

  const handleMFA=()=>{
    if(mfaCode.length===6){
      setProcessing(true);
      setTimeout(()=>{setProcessing(false);setStep(4);},1200);
    }
  };

  // Step 4: confirmed
  if(step===4)return(
    <div className="sc" style={{paddingBottom:40}}>
      <div style={{background:"linear-gradient(145deg,#064E3B,#10B981)",padding:"48px 28px 36px",textAlign:"center"}}>
        <div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:32,margin:"0 auto 16px"}}>✓</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:30,color:"white",marginBottom:6}}>You're all booked!</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,.75)"}}>Powered by Stripe · PCI-DSS compliant</div>
      </div>
      <div style={{padding:"20px 20px 0"}}>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:16}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Transaction ID</span>
            <span style={{fontSize:12,color:C.t1,fontWeight:600,fontFamily:"monospace"}}>pi_3PxK8R{Math.random().toString(36).slice(2,8).toUpperCase()}</span>
          </div>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Amount charged</span>
            <span style={{fontSize:13,color:C.t1,fontWeight:700}}>${perPerson.toLocaleString()}</span>
          </div>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Payment method</span>
            <span style={{fontSize:13,color:C.t1}}>Visa ···4242</span>
          </div>
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:C.t2}}>Security</span>
            <span style={{fontSize:12,color:C.green,fontWeight:600}}>🔒 3D Secure · MFA verified</span>
          </div>
        </div>
        <div style={{marginBottom:16}}>
          <div className="sl" style={{marginBottom:10}}>Booking confirmations</div>
          {[
            {e:"✈️",l:"Flights",v:"Confirmed · Emails sent"},
            {e:"🏨",l:"Hotel",v:"Reserved · Confirmation #HTL-8821"},
            {e:"🎯",l:"Activities",v:"Booked · Vouchers sent"},
            {e:"🍽️",l:"Restaurants",v:"Reserved · Added to itinerary"},
            {e:"🚗",l:"Transport",v:"Confirmed · Driver details sent"},
          ].map((b,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontSize:20}}>{b.e}</span>
              <div style={{flex:1}}><div style={{fontSize:13,color:C.t1,fontWeight:500}}>{b.l}</div><div style={{fontSize:11,color:C.green}}>{b.v}</div></div>
            </div>
          ))}
        </div>
        <div style={{background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:14,marginBottom:16}}>
          <div style={{fontSize:12,color:C.t2,lineHeight:1.6}}>
            <strong style={{color:C.t1}}>Your card number was never stored.</strong> Reach uses Stripe tokenization — only a payment token is saved on our servers. Your full card details go directly to Stripe's PCI-DSS Level 1 vault.
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          <button className="bsm bsm-p" style={{flex:1,padding:"12px 0"}} onClick={()=>toast("Receipt sent to your email")}>Email receipt</button>
          <button className="bsm bsm-g" style={{flex:1,padding:"12px 0"}} onClick={()=>toast("Receipt downloaded")}>Download PDF</button>
        </div>
        <button className="bp" onClick={()=>{updateGroup(groupId,g=>({...g,plans:g.plans.map(p=>p.id===planId?{...p,status:"booked"}:p)}));toast("Plan fully booked!");onBack();}}>View Itinerary →</button>
      </div>
    </div>
  );

  return(
    <div className="sc">
      {/* Header */}
      <div style={{padding:"12px 20px 14px"}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:12,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Back</button>
        <div className="pt" style={{fontSize:24}}>
          {step===0?"Review booking":step===1?"How would you like to split?":step===2?"Secure payment":step===3?"Confirm your identity":""}
        </div>
        <div style={{fontSize:13,color:C.t2,marginBottom:12}}>{plan.title}</div>
        <div className="sd">{[0,1,2,3].map(i=><div key={i} className={`sd-d ${i<=step?"active":""}`}/>)}</div>
      </div>

      {/* Step 0: Review */}
      {step===0&&(
        <div>
          {lines.map((line,i)=>(
            <div key={i} className="bk-row">
              <div className="bk-k">{line.l}<br/><span style={{fontSize:11,color:C.t3}}>{line.d}</span></div>
              <div className="bk-v" style={{color:line.a===0?C.green:C.t1}}>{line.a===0?"Free":`$${line.a.toLocaleString()}`}</div>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",padding:"14px 20px",background:C.accentDim,borderTop:`1px solid ${C.accentBorder}`}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:C.t1}}>Your share</div>
              <div style={{fontSize:11,color:C.t2}}>{plan.participants.length} travelers · ${total.toLocaleString()} total</div>
            </div>
            <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1}}>${perPerson.toLocaleString()}</div>
          </div>
          <div style={{padding:"16px 20px"}}>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:14}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <span style={{fontSize:18,flexShrink:0}}>🔒</span>
                <div style={{fontSize:13,color:C.t2,lineHeight:1.6}}>
                  <strong style={{color:C.t1}}>Powered by Stripe.</strong> Your card details are encrypted end-to-end and processed by Stripe (PCI-DSS Level 1). Reach never sees or stores your full card number.
                </div>
              </div>
            </div>
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:16}}>
              <div style={{fontSize:12,color:C.t2,lineHeight:1.6}}>
                <strong style={{color:C.t1}}>Refund policy:</strong> Full refund within 24 hours. 80% refund up to 7 days before travel. No refund within 48 hours of departure.
              </div>
            </div>
            <button className="bp" onClick={()=>setStep(1)}>Continue to split options →</button>
          </div>
        </div>
      )}

      {/* Step 1: Split method */}
      {step===1&&(
        <div style={{padding:"0 20px"}}>
          <div style={{fontSize:13,color:C.t2,marginBottom:16}}>Choose how your group pays. Each traveler is billed ${perPerson.toLocaleString()} individually through Stripe.</div>
          {[
            {id:"personal",e:"💳",l:"Pay with my card",s:`$${perPerson.toLocaleString()} charged to you now`,security:"Stripe tokenized · CVV never stored"},
            {id:"wallet",e:"💰",l:"Use Group Wallet",s:`$${group.wallet} available · $${Math.max(0,perPerson-group.wallet).toLocaleString()} remainder on card`,security:"Instant · No additional auth needed"},
            {id:"split",e:"🔀",l:"Request split from group",s:`Each of ${plan.participants.length} people pays $${perPerson.toLocaleString()} separately`,security:"Reach sends secure payment links via SMS or email"},
          ].map(opt=>(
            <div key={opt.id} onClick={()=>setSplitMethod(opt.id)} style={{padding:14,borderRadius:16,border:`2px solid ${splitMethod===opt.id?C.accent:C.border}`,background:splitMethod===opt.id?C.accentDim:C.s2,marginBottom:10,cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                <span style={{fontSize:24}}>{opt.e}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.t1}}>{opt.l}</div>
                  <div style={{fontSize:12,color:C.t2,marginTop:2}}>{opt.s}</div>
                </div>
                {splitMethod===opt.id&&<div style={{color:C.accent}}><Ic.Check/></div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                <span style={{fontSize:12}}>🔒</span>
                <span style={{fontSize:11,color:C.t3}}>{opt.security}</span>
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:6,paddingBottom:20}}>
            <button className="bs" style={{flex:1}} onClick={()=>setStep(0)}>← Back</button>
            <button className="bp" style={{flex:2}} onClick={()=>setStep(2)}>Continue to payment →</button>
          </div>
        </div>
      )}

      {/* Step 2: Stripe payment form */}
      {step===2&&(
        <div style={{padding:"0 20px"}}>
          {/* Stripe badge */}
          <div style={{display:"flex",alignItems:"center",gap:8,background:C.s2,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",marginBottom:18}}>
            <span style={{fontSize:16}}>🔒</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:600,color:C.t1}}>Stripe Secure Checkout</div>
              <div style={{fontSize:11,color:C.t3}}>256-bit TLS encryption · PCI-DSS Level 1 · 3D Secure</div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:"#635BFF",fontFamily:"'Space Grotesk',sans-serif"}}>S</div>
          </div>

          {/* Use saved card toggle */}
          <div onClick={()=>setUseSaved(!useSaved)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:C.s2,borderRadius:12,border:`1px solid ${useSaved?C.accentBorder:C.border}`,marginBottom:14,cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:20}}>💳</span>
              <div>
                <div style={{fontSize:13,fontWeight:500,color:C.t1}}>Visa ending 4242</div>
                <div style={{fontSize:11,color:C.t2}}>Saved card · Exp. 12/27</div>
              </div>
            </div>
            <div style={{width:20,height:20,borderRadius:"50%",border:`2px solid ${useSaved?C.accent:C.border}`,background:useSaved?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
              {useSaved&&<div style={{width:8,height:8,borderRadius:"50%",background:"white"}}/>}
            </div>
          </div>

          {!useSaved&&(
            <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{fontSize:11,color:C.t3,marginBottom:12,textTransform:"uppercase",letterSpacing:".06em"}}>New card — tokenized via Stripe.js</div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:12,color:C.t3,marginBottom:5}}>Card number</div>
                <div style={{position:"relative"}}>
                  <input className="inp" value={cardNum} onChange={e=>setCardNum(fmtCard(e.target.value))} placeholder="1234 5678 9012 3456" inputMode="numeric" style={{paddingRight:44,fontFamily:"monospace",letterSpacing:"0.05em"}}/>
                  <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",fontSize:18}}>
                    {cardNum.startsWith("4")?"💳":cardNum.startsWith("5")?"💳":cardNum.startsWith("3")?"💳":"💳"}
                  </span>
                </div>
              </div>
              <div style={{display:"flex",gap:10,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:5}}>Expiry</div>
                  <input className="inp" value={cardExp} onChange={e=>setCardExp(fmtExp(e.target.value))} placeholder="MM/YY" inputMode="numeric" style={{fontFamily:"monospace"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.t3,marginBottom:5}}>CVC</div>
                  <input className="inp" type="password" value={cardCvc} onChange={e=>setCardCvc(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="···" inputMode="numeric" style={{fontFamily:"monospace"}}/>
                </div>
              </div>
              <div>
                <div style={{fontSize:12,color:C.t3,marginBottom:5}}>Name on card</div>
                <input className="inp" value={cardName} onChange={e=>setCardName(e.target.value)} placeholder="Name on card" autoComplete="cc-name"/>
              </div>
              <div style={{marginTop:10,fontSize:11,color:C.t3,lineHeight:1.5}}>
                🔒 Your card number is sent directly to Stripe via an encrypted connection. It never touches Reach's servers. Your CVV is never stored anywhere.
              </div>
            </div>
          )}

          {/* Billing summary */}
          <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:13,color:C.t2}}>Amount due</span>
              <span style={{fontSize:16,fontWeight:700,color:C.t1}}>${perPerson.toLocaleString()}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:12,color:C.t3}}>Split method</span>
              <span style={{fontSize:12,color:C.t2}}>{splitMethod==="personal"?"Your card":splitMethod==="wallet"?"Group Wallet":"Split with group"}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:C.t3}}>Authentication</span>
              <span style={{fontSize:12,color:C.amber}}>⚡ 3D Secure + MFA required</span>
            </div>
          </div>

          <div style={{display:"flex",gap:10,paddingBottom:20}}>
            <button className="bs" style={{flex:1}} onClick={()=>setStep(1)}>← Back</button>
            <button className="bp" style={{flex:2,background:processing?C.s3:C.accent}} onClick={handleStripeSubmit} disabled={processing||(!useSaved&&(!cardNum||!cardExp||!cardCvc||!cardName))}>
              {processing?"Processing…":"Pay $"+perPerson.toLocaleString()+" →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: MFA / 3D Secure */}
      {step===3&&(
        <div style={{padding:"0 20px",textAlign:"center"}}>
          <div style={{fontSize:52,marginBottom:16,marginTop:8}}>📱</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.t1,marginBottom:8}}>Confirm your identity</div>
          <div style={{fontSize:13,color:C.t2,lineHeight:1.7,marginBottom:24}}>
            Because this payment exceeds $500, your bank requires 3D Secure authentication. Enter the 6-digit code sent to <strong style={{color:C.t1}}>+1 ···· 4821</strong>.
          </div>
          <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:"20px 16px",marginBottom:20}}>
            <div style={{fontSize:11,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Authentication code</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:16}}>
              {[0,1,2,3,4,5].map(i=>(
                <div key={i} style={{width:38,height:48,borderRadius:10,border:`2px solid ${mfaCode.length>i?C.accent:C.border}`,background:mfaCode.length>i?C.accentDim:C.s3,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",fontSize:22,color:C.t1,fontWeight:700}}>
                  {mfaCode[i]||""}
                </div>
              ))}
            </div>
            {/* Numpad */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
                <button key={i} onClick={()=>{
                  if(d==="⌫")setMfaCode(c=>c.slice(0,-1));
                  else if(d!==""&&mfaCode.length<6)setMfaCode(c=>c+String(d));
                }} style={{height:52,borderRadius:12,background:d===""?C.bg:C.s1,border:`1px solid ${d===""?C.bg:C.border}`,color:C.t1,fontSize:18,fontWeight:500,fontFamily:"'Space Grotesk',sans-serif",cursor:d===""?"default":"pointer"}}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <button className="bp" style={{background:mfaCode.length===6?(processing?C.s3:C.green):C.s3,transition:"background .2s"}} onClick={handleMFA} disabled={mfaCode.length<6||processing}>
              {processing?"Verifying…":mfaCode.length===6?"Verify & Book →":"Enter 6 digits"}
            </button>
          </div>
          <button style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",padding:"8px 0"}} onClick={()=>toast("A new code has been sent")}>Resend code</button>
          <div style={{fontSize:11,color:C.t3,marginTop:12,lineHeight:1.5,paddingBottom:20}}>
            Required by PSD2 Strong Customer authentication (SCA) for payments over $500. This protects you from unauthorized charges.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function ProfileScreen({toast,user,onSignOut}){
  const [section,setSection]=useState(null);
  const [deleteConfirm,setDeleteConfirm]=useState("");
  const [privToggles,setPrivToggles]=useState({personalized:true,analytics:true,marketing:false,thirdParty:false});
  const sessions=[
    {device:"iPhone 15 Pro",loc:"San Francisco, CA",last:"Active now",cur:true},
    {device:"MacBook Pro",loc:"San Francisco, CA",last:"2 hours ago",cur:false},
    {device:"iPad Air",loc:"New York, NY",last:"3 days ago",cur:false},
  ];

  if(section==="security")return(
    <div className="sc">
      <div style={{padding:"12px 20px 16px"}}>
        <button onClick={()=>setSection(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:14,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Profile</button>
        <div className="pt" style={{fontSize:24}}>Security</div>
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Sign-in methods</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"🍎",l:"Sign in with Apple",v:user?.provider==="apple"?"Active · Primary":"Not connected",ok:user?.provider==="apple"},
          {e:"🌐",l:"Sign in with Google",v:user?.provider==="google"?"Active · Primary":"Not connected",ok:user?.provider==="google"},
          {e:"📧",l:"Email & password",v:user?.provider==="email"?"Active":"Backup only",ok:user?.provider==="email"},
          {e:"🤳",l:"Face ID or Touch ID",v:"Enabled",ok:true},
          {e:"🔢",l:"6-digit PIN",v:"Set · Changed 14 days ago",ok:true},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast(it.l+" settings")}>
              <div className="ri-ic" style={{background:it.ok?C.accentDim:C.s3,color:it.ok?C.accent:C.t3}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s" style={{color:it.ok?C.green:C.t3}}>{it.v}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Two-factor authentication</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"📱",l:"SMS verification",v:"+1 ···· 4821 · Enabled",ok:true},
          {e:"🔑",l:"Authenticator app",v:"Not set up",ok:false},
          {e:"🧾",l:"Backup only codes",v:"10 codes remaining",ok:true},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast(it.l+" settings")}>
              <div className="ri-ic" style={{background:it.ok?C.greenDim:C.s3,color:it.ok?C.green:C.t3}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s" style={{color:it.ok?C.green:C.t3}}>{it.v}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Active sessions</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {sessions.map((s,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri">
              <div className="ri-ic" style={{background:s.cur?C.accentDim:C.s3,color:s.cur?C.accent:C.t2}}>{s.cur?"📍":"💻"}</div>
              <div className="ri-inf">
                <div className="ri-t">{s.device}{s.cur&&<span style={{fontSize:10,background:C.greenDim,color:C.green,padding:"1px 6px",borderRadius:10,marginLeft:6}}>This device</span>}</div>
                <div className="ri-s">{s.loc} · {s.last}</div>
              </div>
              {!s.cur&&<button className="bsm bsm-r" onClick={()=>toast("Session revoked")}>Revoke</button>}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 10px"}}><button className="bs" style={{borderColor:C.red,color:C.red}} onClick={()=>toast("All other sessions have been signed out")}>Sign out of all other devices</button></div>
      <div style={{margin:"12px 20px 30px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14}}>
        <div style={{fontSize:12,color:C.t2,lineHeight:1.8}}>
          <strong style={{color:C.t1}}>How your data is protected</strong><br/>
          🔐 Passwords: Argon2id hashing — never stored in plain text<br/>
          🔒 Sensitive data: AES-256 encryption at rest<br/>
          🌐 All traffic: TLS 1.3 minimum<br/>
          💳 Card data: Stripe PCI-DSS Level 1 vault<br/>
          📍 Location: approximate only, cleared after each session<br/>
          🎫 Auth tokens: 15-minute JWT with rotating refresh tokens
        </div>
      </div>
    </div>
  );

  if(section==="payment")return(
    <div className="sc">
      <div style={{padding:"12px 20px 16px"}}>
        <button onClick={()=>setSection(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:14,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Profile</button>
        <div className="pt" style={{fontSize:24}}>Payment</div>
      </div>
      <div style={{margin:"0 20px 14px",background:C.accentDim,border:`1px solid ${C.accentBorder}`,borderRadius:14,padding:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>🔒</span>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.t1}}>Powered by Stripe — PCI-DSS Level 1</div>
            <div style={{fontSize:11,color:C.t2}}>Your full card number is never stored on Reach's servers. Only Stripe tokens are saved.</div>
          </div>
        </div>
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Saved cards (tokenized)</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"💳",l:"Visa ···4242",v:"Primary · Exp. 12/27 · Added Jun 2024"},
          {e:"💳",l:"Amex ···9401",v:"Backup only · Exp 06/26 · Added Jan 2024"},
          {e:"➕",l:"Add a new card",v:"Encrypted via Stripe.js — CVV is never stored",action:true},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast(it.action?"Add card via Stripe":it.l+" options")}>
              <div className="ri-ic" style={{background:it.action?C.s3:C.accentDim,color:it.action?C.t3:C.accent}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t" style={{color:it.action?C.accent:C.t1}}>{it.l}</div><div className="ri-s">{it.v}</div></div>
              {!it.action&&<button className="bsm bsm-r" onClick={e=>{e.stopPropagation();toast("Card removed");}}>Remove</button>}
              {it.action&&<Ic.ChevR/>}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Spending limits & security</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"💵",l:"Single transaction limit",v:"$5,000"},
          {e:"📅",l:"Monthly spend limit",v:"$12,000"},
          {e:"⚡",l:"MFA required above",v:"$500 — 3D Secure enforced"},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast("Edit "+it.l)}>
              <div className="ri-ic" style={{background:C.accentDim,color:C.accent}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s">{it.v}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Recent transactions</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 30px",overflow:"hidden"}}>
        {[

          {e:"↩️",l:"Refund: Amsterdam",v:"+$480 · May 28 · re_3Pn…",c:C.green},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast("Transaction details")}>
              <div className="ri-ic" style={{background:C.s3,color:C.t2}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s" style={{fontFamily:"monospace",fontSize:11}}>{it.v}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if(section==="privacy")return(
    <div className="sc">
      <div style={{padding:"12px 20px 16px"}}>
        <button onClick={()=>setSection(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:14,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Profile</button>
        <div className="pt" style={{fontSize:24}}>Privacy</div>
        <div style={{fontSize:12,color:C.t2,marginTop:4}}>GDPR · CCPA · App Store 5.1 compliant</div>
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Data usage</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {k:"personalized",l:"Personalized recommendations",s:"AI learns from your trips to suggest relevant experiences"},
          {k:"analytics",l:"App analytics",s:"Anonymous performance data — no personal information is shared"},
          {k:"marketing",l:"Marketing emails",s:"Inspiration and product updates (at most weekly)"},
          {k:"thirdParty",l:"Share with booking partners",s:"Pre-fills your details when booking flights and hotels"},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 20px"}}>
              <div style={{flex:1}}><div style={{fontSize:14,fontWeight:500,color:C.t1}}>{it.l}</div><div style={{fontSize:12,color:C.t2,marginTop:2}}>{it.s}</div></div>
              <button onClick={()=>setPrivToggles(p=>({...p,[it.k]:!p[it.k]}))} style={{width:44,height:26,borderRadius:13,background:privToggles[it.k]?C.accent:C.s3,border:"none",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
                <div style={{width:20,height:20,borderRadius:"50%",background:"white",position:"absolute",top:3,left:privToggles[it.k]?21:3,transition:"left .2s"}}/>
              </button>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Location data</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"📍",l:"Location access",v:"While using the app · City-level approximate only"},
          {e:"🗂️",l:"Location history",v:"Not stored — cleared after each session"},
          {e:"🤝",l:"Share location with group",v:"Only during active trips — you control when"},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>toast(it.l+" settings")}>
              <div className="ri-ic" style={{background:C.greenDim,color:C.green}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s">{it.v}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 6px"}}><span className="sl">Your data rights</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 14px",overflow:"hidden"}}>
        {[
          {e:"📦",l:"Download my data",s:"GDPR Art. 20 — export everything as JSON"},
          {e:"✏️",l:"Correct my data",s:"GDPR Art. 16 — fix inaccuracies"},
          {e:"🚫",l:"Opt out of data sale",s:"CCPA — we never sell your data, but you can confirm this here"},
          {e:"🗑️",l:"Delete my account",s:"GDPR Art. 17 — permanent, 30-day processing",danger:true},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={()=>it.danger?setSection("delete"):toast(it.l+" request submitted")}>
              <div className="ri-ic" style={{background:it.danger?C.redDim:C.s3,color:it.danger?C.red:C.t2}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t" style={{color:it.danger?C.red:C.t1}}>{it.l}</div><div className="ri-s">{it.s}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{margin:"0 20px 30px",background:C.s2,border:`1px solid ${C.border}`,borderRadius:14,padding:14}}>
        <div style={{fontSize:12,color:C.t2,lineHeight:1.7}}>Reach complies with <strong style={{color:C.t1}}>GDPR</strong> (EU), <strong style={{color:C.t1}}>CCPA</strong> (California), <strong style={{color:C.t1}}>COPPA</strong> (under-13), and <strong style={{color:C.t1}}>PSD2 SCA</strong>. Data requests are processed within 30 days. <span style={{color:C.accent}}>reach.app/privacy</span></div>
      </div>
    </div>
  );

  if(section==="delete")return(
    <div className="sc">
      <div style={{padding:"12px 20px 16px"}}>
        <button onClick={()=>{setSection("privacy");setDeleteConfirm("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.t2,display:"flex",alignItems:"center",gap:4,fontSize:13,marginBottom:14,fontFamily:"'Space Grotesk',sans-serif"}}><Ic.ChevL/> Privacy</button>
        <div className="pt" style={{fontSize:24,color:C.red}}>Delete account</div>
      </div>
      <div style={{padding:"0 20px"}}>
        <div style={{background:C.redDim,border:`1px solid ${C.red}`,borderRadius:14,padding:14,marginBottom:18}}>
          <div style={{fontSize:14,fontWeight:600,color:C.red,marginBottom:6}}>⚠️ This cannot be undone</div>
          <div style={{fontSize:13,color:C.t2,lineHeight:1.7}}>All your data will be permanently deleted within 30 days, per GDPR Article 17 (Right to Erasure). Your card tokens will be removed from Stripe, and any active bookings will be cancelled.</div>
        </div>
        <div className="sl" style={{marginBottom:10}}>What gets permanently deleted</div>
        {["Profile & preferences","All trip plans & itineraries","Group memberships and history","Payment tokens (Stripe handles card deletion)","Location history","Travel documents","Loyalty program data"].map((it,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
            <span style={{color:C.red,fontSize:14,flexShrink:0}}>✕</span>
            <span style={{fontSize:13,color:C.t2}}>{it}</span>
          </div>
        ))}
        <div style={{marginTop:20,marginBottom:10}}>
          <div style={{fontSize:13,color:C.t1,marginBottom:8}}>Type <strong style={{color:C.red}}>DELETE</strong> to confirm</div>
          <input className="inp" value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value.toUpperCase())} placeholder="DELETE" style={{borderColor:deleteConfirm==="DELETE"?C.red:C.border,color:C.red,fontWeight:600,letterSpacing:".12em"}}/>
        </div>
        <button className="bp" style={{background:deleteConfirm==="DELETE"?C.red:C.s3,marginBottom:10,transition:"background .2s"}} disabled={deleteConfirm!=="DELETE"} onClick={()=>{toast("Account deletion scheduled · 30-day processing · Confirmation email sent");setSection(null);setDeleteConfirm("");}}>
          Permanently delete my account
        </button>
        <button className="bs" onClick={()=>{setSection("privacy");setDeleteConfirm("");}}>Cancel</button>
        <div style={{fontSize:11,color:C.t3,textAlign:"center",marginTop:12,paddingBottom:30,lineHeight:1.5}}>Your data will be deleted within 30 days per GDPR Art. 17. You will receive an email confirmation with a deletion receipt.</div>
      </div>
    </div>
  );

  return(
    <div style={{padding:"12px 0 0"}}>
      <div style={{padding:"10px 20px 18px",textAlign:"center"}}>
        <div style={{width:80,height:80,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},#C084FC)`,margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Instrument Serif',serif",fontSize:32,color:"white",border:`3px solid ${C.border}`}}>{user?.avatar?<img src={user.avatar} style={{width:80,height:80,borderRadius:"50%",objectFit:"cover"}} alt=""/>:(user?.name||"?")[0]}</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1}}>{user?.name||user?.email||"You"}</div>
        <div style={{fontSize:13,color:C.t2,marginTop:2}}>
          {user?.email||"alex@example.com"}
          {user?.provider&&user.provider!=="email"&&<span style={{marginLeft:6,fontSize:11,background:C.accentDim,color:C.accent,padding:"2px 8px",borderRadius:20,fontWeight:600}}>{user.provider==="apple"?"🍎 Apple":"🌐 Google"}</span>}
        </div>
        <div style={{display:"flex",gap:0,background:C.s2,borderRadius:16,marginTop:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {[{v:"14",l:"Experiences"},{v:"3",l:"Groups"},{v:"9",l:"Friends"}].map((s,i)=>(
            <div key={i} style={{flex:1,padding:"13px 0",textAlign:"center",borderLeft:i?`1px solid ${C.border}`:"none"}}>
              <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.accent}}>{s.v}</div>
              <div style={{fontSize:10,color:C.t3,textTransform:"uppercase",letterSpacing:".06em",marginTop:2}}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:"flex",gap:10,padding:"0 20px 16px"}}>
        {[{icon:"🔒",label:"Security",key:"security",color:C.accent},{icon:"🛡️",label:"Privacy",key:"privacy",color:C.green},{icon:"💳",label:"Payment",key:"payment",color:C.amber}].map(it=>(
          <button key={it.key} onClick={()=>setSection(it.key)} style={{flex:1,padding:"12px 8px",borderRadius:14,border:`1px solid ${C.border}`,background:C.s2,cursor:"pointer",textAlign:"center",fontFamily:"'Space Grotesk',sans-serif"}}>
            <div style={{fontSize:22,marginBottom:4}}>{it.icon}</div>
            <div style={{fontSize:11,fontWeight:600,color:it.color}}>{it.label}</div>
          </button>
        ))}
      </div>
      {[
        {title:"Travel Documents",items:[{e:"🛂",l:"Passport",v:"US · Exp 2029 · AES-256 encrypted"},{e:"🪪",l:"TSA PreCheck",v:"KTN-928374 · Encrypted"},{e:"✈️",l:"Global Entry",v:"Active"}]},
        {title:"Loyalty Programs",items:[{e:"🌐",l:"United MileagePlus",v:"1K · 84,200 mi"},{e:"🏨",l:"Marriott Bonvoy",v:"Platinum · 45k pts"},{e:"🚗",l:"Hertz Gold Plus",v:"Five Star"},{e:"➕",l:"Add program",v:"",action:true}]},
        {title:"Preferences",items:[{e:"🍽️",l:"Dietary needs",v:"No restrictions"},{e:"🪑",l:"Seat preference",v:"Aisle · Economy+"},{e:"♿",l:"Accessibility",v:"None set"},{e:"🌡️",l:"Climate preference",v:"Warm weather"}]},
        {title:"Notifications",items:[{e:"🔔",l:"Trip updates",v:"Instant"},{e:"💬",l:"Group messages",v:"Instant"},{e:"💰",l:"Payment alerts",v:"Instant — required for security"},{e:"🎯",l:"Recommendations",v:"Weekly digest"}]},
      ].map((sec,si)=>(
        <div key={si} style={{marginBottom:8}}>
          <div style={{padding:"6px 20px 8px"}}><span className="sl">{sec.title}</span></div>
          <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px",overflow:"hidden"}}>
            {sec.items.map((item,ii)=>(
              <div key={ii}>
                {ii>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
                <div className="ri" onClick={()=>toast(item.action?`Add ${item.l}`:item.l+" updated")}>
                  <div className="ri-ic" style={{background:item.action?C.s3:C.accentDim,color:item.action?C.t3:C.accent}}>{item.e}</div>
                  <div className="ri-inf"><div className="ri-t" style={{color:item.action?C.accent:C.t1}}>{item.l}</div>{item.v&&<div className="ri-s">{item.v}</div>}</div>
                  <Ic.ChevR/>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{padding:"0 20px 6px"}}><span className="sl">Account & Security</span></div>
      <div style={{background:C.s1,border:`1px solid ${C.border}`,borderRadius:16,margin:"0 20px 16px",overflow:"hidden"}}>
        {[
          {e:"🔒",l:"Security settings",s:"MFA · sessions · biometrics",fn:()=>setSection("security")},
          {e:"🛡️",l:"Privacy & data rights",s:"GDPR · CCPA · data export · deletion",fn:()=>setSection("privacy")},
          {e:"💳",l:"Payment methods",s:"Stripe-secured — card numbers are never stored",fn:()=>setSection("payment")},
        ].map((it,i)=>(
          <div key={i}>
            {i>0&&<div style={{height:1,background:C.border,margin:"0 16px"}}/>}
            <div className="ri" onClick={it.fn}>
              <div className="ri-ic" style={{background:C.accentDim,color:C.accent}}>{it.e}</div>
              <div className="ri-inf"><div className="ri-t">{it.l}</div><div className="ri-s">{it.s}</div></div>
              <Ic.ChevR/>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:"0 20px 30px",display:"flex",flexDirection:"column",gap:10}}>
        <button className="bs" style={{borderColor:C.red,color:C.red}} onClick={()=>{if(onSignOut)onSignOut();else toast("Signed out successfully");}}>Sign out</button>
        <div style={{display:"flex",justifyContent:"center",gap:16,paddingTop:4}}>
          {["Privacy Policy","Terms","Licenses","Support"].map(l=><span key={l} style={{fontSize:11,color:C.t3,cursor:"pointer"}} onClick={()=>toast(l+" opening")}>{l}</span>)}
        </div>
        <div style={{fontSize:10,color:C.t4,textAlign:"center"}}>Reach v1.0.0 · GDPR · CCPA · PCI-DSS · SOC 2 Type II</div>
      </div>
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function ReachApp({realUser}={}){
  // Auth flow stages: splash → auth → permissions → biometric → privacy → app
  const [authStage,setAuthStage]=useState(realUser!=null?"app":"splash"); // splash|auth|permissions|biometric|privacy|app
  const [user,setUser]=useState(realUser??null);
  const [tab,setTab]=useState("home");
  const [groups,setGroups]=useState([]);
  const [groupsLoading,setGroupsLoading]=useState(true);
  const [toastMsg,setToastMsg]=useState(null);
  const [stack,setStack]=useState([]);

  // User map: combines demo contacts + any real users from API
  const um=Object.fromEntries(ALL_CONTACTS.map(u=>[u.id,u]));
  // Real user lookup helper — returns a placeholder if user not in map
  const getUser=(id)=>um[id]||{id,name:"Member",handle:"@member",color:C.accent,initials:"??"};

  // ── Location state ───────────────────────────────────────
  const [userLocation,setUserLocation]=useState(null); // {lat,lng,city,airport}

  // ── Load real data from Supabase via API ──────────────────
  useEffect(()=>{
    if(authStage!=="app")return;
    // Auto-create user in Supabase if not exists + get location
    syncUser();
    loadGroups();
    getLocation();
  },[authStage]);

  const syncUser=async()=>{
    try{
      const res=await fetch("/api/me");
      if(res.ok){
        const data=await res.json();
        setUser(u=>u?({...u,...data,id:data.id}):data);
      }
    }catch(e){console.log("User sync failed",e);}
  };

  // ── Push notifications ─────────────────────────────────
  const requestNotifications=async()=>{
    if(typeof Notification==="undefined")return;
    if(Notification.permission==="granted")return;
    if(Notification.permission!=="denied"){
      await Notification.requestPermission();
    }
  };

  const sendNotification=(title,body,onClick)=>{
    if(typeof Notification==="undefined")return;
    if(Notification.permission!=="granted")return;
    try{
      const n=new Notification(title,{
        body,
        icon:"/icon-192.png",
        badge:"/icon-192.png",
        tag:"reach-"+Date.now(),
      });
      if(onClick)n.onclick=onClick;
    }catch(e){}
  };

  // Notify group members when a plan changes
  const notifyGroupUpdate=(groupName,message)=>{
    sendNotification(
      "Reach — "+groupName,
      message,
      ()=>window.focus()
    );
  };

  // Request notification permission on first load
  useEffect(()=>{
    if(authStage==="app"){
      setTimeout(requestNotifications, 2000);
    }
  },[authStage]);

  const getLocation=()=>{
    if(typeof navigator==="undefined"||!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(
      async function(pos){
        try{
          const lat=pos.coords.latitude;
          const lng=pos.coords.longitude;
          // Reverse geocode to get city name
          const res=await fetch("https://nominatim.openstreetmap.org/reverse?lat="+lat+"&lon="+lng+"&format=json");
          if(res.ok){
            const geo=await res.json();
            const city=geo.address?.city||geo.address?.town||geo.address?.county||"Your city";
            const state=geo.address?.state_code||"";
            // Find nearest major airport (simplified - use city)
            const airport=getNearestAirport(city,state);
            setUserLocation({lat,lng,city,state,airport,formatted:city+(state?", "+state:"")});
          }else{
            setUserLocation({lat,lng,city:"Your location",airport:null});
          }
        }catch(e){setUserLocation({lat:pos.coords.latitude,lng:pos.coords.longitude,city:"Your location",airport:null});}
      },
      function(err){console.log("Location denied:",err.message);},
      {timeout:10000,enableHighAccuracy:false,maximumAge:600000}
    );
  };

  const getNearestAirport=(city,state)=>{
    // Major airport lookup by city
    const airports={
      "New York":"JFK","Los Angeles":"LAX","Chicago":"ORD","Houston":"IAH",
      "Phoenix":"PHX","Philadelphia":"PHL","San Antonio":"SAT","San Diego":"SAN",
      "Dallas":"DFW","San Jose":"SJC","Austin":"AUS","Jacksonville":"JAX",
      "Fort Worth":"DFW","Columbus":"CMH","Charlotte":"CLT","Indianapolis":"IND",
      "San Francisco":"SFO","Seattle":"SEA","Denver":"DEN","Nashville":"BNA",
      "Boston":"BOS","Las Vegas":"LAS","Portland":"PDX","Miami":"MIA",
      "Atlanta":"ATL","Minneapolis":"MSP","New Orleans":"MSY","Detroit":"DTW",
      "Memphis":"MEM","Baltimore":"BWI","Louisville":"SDF","Milwaukee":"MKE",
      "Albuquerque":"ABQ","Tucson":"TUS","Fresno":"FAT","Sacramento":"SMF",
      "Kansas City":"MCI","Mesa":"PHX","Omaha":"OMA","Raleigh":"RDU",
      "Colorado Springs":"COS","Long Beach":"LGB","Virginia Beach":"ORF",
      "Oakland":"OAK","Minneapolis":"MSP","Tulsa":"TUL","Tampa":"TPA",
      "Arlington":"DFW","New Orleans":"MSY","Wichita":"ICT","Cleveland":"CLE",
      "Tampa":"TPA","Bakersfield":"BFL","Aurora":"DEN","Anaheim":"SNA",
      "Orlando":"MCO","Pittsburgh":"PIT","Salt Lake City":"SLC","Birmingham":"BHM",
    };
    return airports[city]||null;
  };

  const loadGroups=async()=>{
    try{
      setGroupsLoading(true);
      const res=await fetch("/api/groups");
      if(!res.ok){setGroupsLoading(false);return;}
      const {groups:data}=await res.json();
      if(!data||data.length===0){setGroupsLoading(false);return;}

      // Load groups first so UI shows immediately
      const base=data.map(g=>({
        id:g.id,
        name:g.name,
        emoji:g.emoji||"✈️",
        memberIds:(g.group_members||[]).map(m=>m.user_id),
        members:(g.group_members||[]).map(m=>m.users||{id:m.user_id}),
        wallet:Math.round((g.wallet_balance_cents||0)/100),
        tags:[],
        lastActivity:g.updated_at?new Date(g.updated_at).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"Just created",
        plans:[],
      }));
      setGroups(base);

      // Then load plans for each group in parallel
      const withPlans=await Promise.all(base.map(async g=>{
        try{
          const r=await fetch(`/api/groups/${g.id}`);
          if(!r.ok)return g;
          const detail=await r.json();
          const plans=(detail.plans||[]).map(p=>convertPlan(p));
          return{...g,plans,lastActivity:plans.length>0?`${plans.length} plan${plans.length>1?"s":""}`:g.lastActivity};
        }catch{return g;}
      }));
      setGroups(withPlans);
    }catch(e){console.log("API unavailable, using local state",e);}
    finally{setGroupsLoading(false);}
  };

  // Convert API plan format to app format
  const convertPlan=(p)=>({
    id:p.id,
    title:p.title,
    type:p.type||"trip",
    status:p.status||"planning",
    dates:p.start_date&&p.end_date?`${p.start_date} – ${p.end_date}`:p.start_date||"Dates TBD",
    budget:Math.round((p.budget_cents||0)/100),
    participants:p.participants||[],
    itinerary:(p.itinerary||[]).map(item=>({
      time:item.scheduled_time||"",
      title:item.title,
      sub:item.subtitle||"",
      type:item.type,
      conf:item.confirmation_number||null,
      filled:item.is_confirmed,
    })),
    votes:p.votes||{},
    options:p.vote_options||[],
    accommodation:p.accommodation,
    vibe:p.vibe,
    destStyle:p.destination_style,
    dealbreakers:p.dealbreakers||[],
  });

  // Refresh a single group's data from server
  const refreshGroup=async(groupId)=>{
    try{
      const r=await fetch(`/api/groups/${groupId}`);
      if(!r.ok)return;
      const detail=await r.json();
      const plans=(detail.plans||[]).map(p=>convertPlan(p));
      const memberIds=(detail.members||[]).map(m=>m.user_id||m.users?.id).filter(Boolean);
      setGroups(gs=>gs.map(g=>g.id===groupId?{...g,plans,memberIds}:g));
    }catch(e){console.log("Refresh failed",e);}
  };

  const saveGroupToServer=async(group)=>{
    try{
      const isNew=!group.id||group.id.startsWith("g_local_");
      if(isNew){
        const res=await fetch("/api/groups",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({name:group.name,emoji:group.emoji,memberIds:group.memberIds||[]}),
        });
        if(res.ok){
          const {group:saved}=await res.json();
          // Replace temp ID with real server ID
          setGroups(gs=>gs.map(g=>g.id===group.id?{...g,id:saved.id}:g));
          return saved.id;
        }
      }else{
        await fetch(`/api/groups/${group.id}`,{
          method:"PATCH",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({name:group.name,emoji:group.emoji}),
        });
      }
    }catch(e){console.log("Group save failed, data kept locally",e);}
    return group.id;
  };

  const savePlanToServer=async(groupId,plan)=>{
    try{
      // Parse dates correctly for both event (single) and trip (range)
      const isRange=plan.dates?.includes("–");
      const startDate=isRange?plan.dates.split("–")[0]?.trim():plan.dates?.split(" at ")[0]||null;
      const endDate=isRange?plan.dates.split("–")[1]?.trim():null;

      const res=await fetch("/api/plans",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          group_id:groupId,
          title:plan.title,
          type:plan.type||"trip",
          start_date:startDate||null,
          end_date:endDate||null,
          budget_cents:(plan.budget||0)*100,
          accommodation:plan.accommodation||null,
          vibe:plan.vibe||null,
          destination_style:plan.destStyle||null,
          dealbreakers:plan.dealbreakers||[],
          vote_options:plan.options||[],
          enable_voting:plan.status==="voting",
        }),
      });
      if(res.ok){
        const {plan:saved}=await res.json();
        // Update local plan with real server ID
        setGroups(gs=>gs.map(g=>g.id===groupId?{...g,plans:g.plans.map(p=>p.id===plan.id?{...p,id:saved.id}:p)}:g));
        return saved.id;
      }
    }catch(e){console.log("Plan save failed, kept locally",e);}
    return plan.id;
  };

  // Update a plan's status on the server
  const updatePlanOnServer=async(planId,updates)=>{
    try{
      await fetch(`/api/plans/${planId}`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(updates),
      });
      // Notify on status changes
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan&&updates.status){
        const msgs={
          voting:plan.title+" is now open for voting!",
          approved:plan.title+" has been approved!",
          booked:plan.title+" is fully booked! 🎉",
        };
        if(msgs[updates.status])notifyGroupUpdate(plan.groupName,msgs[updates.status]);
      }
    }catch(e){console.log("Plan update failed",e);}
  };

  // Cast a vote on the server
  const castVoteOnServer=async(planId,option)=>{
    try{
      await fetch(`/api/plans/${planId}/vote`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({option}),
      });
      // Find which group/plan this is for notification context
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan)notifyGroupUpdate(plan.groupName,`${user?.firstName||"Someone"} voted for ${option}`);
    }catch(e){console.log("Vote failed",e);}
  };

  // Save itinerary items to server
  const saveItineraryToServer=async(planId,items)=>{
    try{
      await fetch(`/api/plans/${planId}/itinerary`,{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({items}),
      });
      const plan=groups.flatMap(g=>g.plans.map(p=>({...p,groupName:g.name}))).find(p=>p.id===planId);
      if(plan)notifyGroupUpdate(plan.groupName,`${user?.firstName||"Someone"} updated the itinerary for ${plan.title}`);
    }catch(e){console.log("Itinerary save failed",e);}
  };
  const showToast=msg=>setToastMsg(msg);
  const push=(screen,props={})=>setStack(s=>[...s,{screen,props}]);
  const pop=()=>setStack(s=>s.slice(0,-1));
  const updateGroup=(gid,fn,{sync=false}={})=>{
    const current=groups.find(g=>g.id===gid);
    if(!current)return;
    const updated=fn(current);
    setGroups(gs=>gs.map(g=>g.id===gid?updated:g));
    if(sync)saveGroupToServer(updated); // only sync when explicitly requested
  };

  const handleAuth=userData=>{setUser(userData);setAuthStage("permissions");};
  const handleSignOut=()=>{setUser(null);setAuthStage("auth");setStack([]);setTab("home");showToast("Signed out successfully");};

  const cur=stack[stack.length-1];
  const cp={onBack:pop,groups,setGroups,updateGroup,um,push,toast:showToast,refreshGroup,updatePlanOnServer,castVoteOnServer,saveItineraryToServer,savePlanToServer,saveGroupToServer,userLocation,notifyGroupUpdate};

  const renderSub=()=>{
    if(!cur)return null;
    const {screen,props}=cur;
    if(screen==="groupDetail")return <GroupDetailScreen {...cp} {...props}/>;
    if(screen==="planDetail")return <PlanDetailScreen {...cp} {...props}/>;
    if(screen==="createGroup")return <CreateGroupScreen {...cp} {...props}/>;
    if(screen==="aiTrip")return <AiTripScreen {...cp} {...props}/>;
    if(screen==="groupTrip")return <GroupTripScreen {...cp} {...props}/>;
    if(screen==="createPlan")return <CreatePlanFlow {...cp} {...props}/>;
    if(screen==="editGroup")return <EditGroupScreen {...cp} {...props} onBack={pop}/>;
    if(screen==="checkout")return <CheckoutScreenV2 {...cp} {...props}/>;
    if(screen==="editItinerary")return <EditItineraryScreen {...cp} {...props}/>;
    if(screen==="expDetail")return <ExpDetailScreen {...cp} {...props} updateGroup={updateGroup} savePlanToServer={savePlanToServer}/>;
    return null;
  };

  const tabs=[
    {id:"home",label:"Home",Icon:Ic.Home},
    {id:"discover",label:"Discover",Icon:Ic.Compass},
    {id:"groups",label:"Groups",Icon:Ic.Users},
    {id:"profile",label:"Profile",Icon:Ic.User},
  ];

  // Show status bar only in app (not during auth flow)
  const showStatusBar=authStage==="app";

  return(
    <>
      <style>{CSS}</style>
      <div className="aw">
        {showStatusBar&&(
          <div className="sb">
            <span>9:41</span>
            <span className="sb-logo">reach</span>
            <span>5G ▪▪▪</span>
          </div>
        )}
        <div className="ma" style={{top:showStatusBar?undefined:0}}>
          {/* ── AUTH FLOW ── */}
          {authStage==="splash"&&(
            <div className="sc" style={{paddingBottom:0}}>
              <SplashScreen onNext={()=>setAuthStage("auth")}/>
            </div>
          )}
          {authStage==="auth"&&(
            <div className="sc" style={{paddingBottom:0}}>
              <AuthScreen onAuth={handleAuth}/>
            </div>
          )}
          {authStage==="permissions"&&(
            <div className="sc" style={{paddingBottom:0}}>
              <PermissionsScreen onDone={()=>setAuthStage("biometric")}/>
            </div>
          )}
          {authStage==="biometric"&&(
            <div className="sc" style={{paddingBottom:0}}>
              <BiometricScreen onDone={()=>setAuthStage("privacy")}/>
            </div>
          )}
          {authStage==="privacy"&&(
            <div className="sc" style={{paddingBottom:0}}>
              <PrivacyScreen onDone={()=>setAuthStage("app")} user={user} setUser={setUser}/>
            </div>
          )}

          {/* ── MAIN APP ── */}
          {authStage==="app"&&(
            <>
              {cur?(
                <div className="sc" style={{paddingBottom:20}}>{renderSub()}</div>
              ):(
                <div className="sc">
                  {tab==="home"&&<HomeScreen groups={groups} um={um} push={push} toast={showToast} loading={groupsLoading} user={user} setTab={setTab}/>}
                  {tab==="discover"&&<DiscoverScreen push={push} groups={groups} toast={showToast} user={user} userLocation={userLocation}/>}
                  {tab==="groups"&&<GroupsScreen groups={groups} um={um} push={push}/>}
                  {tab==="profile"&&<ProfileScreen toast={showToast} user={user} onSignOut={handleSignOut}/>}
                </div>
              )}
              {!cur&&(
                <nav className="nb">
                  {tabs.map(({id,label,Icon})=>(
                    <button key={id} className={`nb-btn ${tab===id?"active":""}`} onClick={()=>setTab(id)}>
                      <Icon/><span>{label}</span><div className="nb-dot"/>
                    </button>
                  ))}
                </nav>
              )}
            </>
          )}
        </div>
        {toastMsg&&<Toast msg={toastMsg} onDone={()=>setToastMsg(null)}/>}
      </div>
    </>
  );
}

// ─── AUTH & COMPLIANCE SCREENS ────────────────────────────────────────────────

// Apple SSO Icon
function AppleIcon(){return(
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);}

function GoogleIcon(){return(
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);}

// ─── SPLASH / ONBOARDING ─────────────────────────────────────────────────────
function SplashScreen({onNext}){
  const [slide,setSlide]=useState(0);
  const slides=[
    {emoji:"✈️",title:"Plan together,\neffortlessly.",sub:"From the first idea to a full itinerary — Reach handles every detail so your group can focus on the fun."},
    {emoji:"🗳️",title:"Everyone has\na voice.",sub:"Vote on destinations, approve budgets, and make decisions your whole group can agree on."},
    {emoji:"🎟️",title:"One tap.\nEverything booked.",sub:"Flights, hotels, restaurants, and activities — all confirmed in a single checkout, split fairly."},
  ];
  const last=slide===slides.length-1;
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 32px 20px"}}>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.accent,letterSpacing:"-.02em",marginBottom:48}}>reach</div>
        <div style={{fontSize:72,marginBottom:32,lineHeight:1}}>{slides[slide].emoji}</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:32,color:C.t1,textAlign:"center",lineHeight:1.15,marginBottom:16,whiteSpace:"pre-line"}}>{slides[slide].title}</div>
        <div style={{fontSize:15,color:C.t2,textAlign:"center",lineHeight:1.6,maxWidth:280}}>{slides[slide].sub}</div>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:28}}>
        {slides.map((_,i)=><div key={i} style={{width:i===slide?20:6,height:6,borderRadius:3,background:i===slide?C.accent:C.s3,transition:"all .3s"}}/>)}
      </div>
      <div style={{padding:"0 24px 40px",display:"flex",flexDirection:"column",gap:10}}>
        {last?(
          <button className="bp" onClick={onNext}>Get started →</button>
        ):(
          <>
            <button className="bp" onClick={()=>setSlide(s=>s+1)}>Next →</button>
            <button className="bs" onClick={onNext} style={{fontSize:13}}>Skip intro</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({onAuth,mode="signin"}){
  const [view,setView]=useState(mode); // signin | signup | magic | forgot
  const [email,setEmail]=useState("");
  const [pw,setPw]=useState("");
  const [name,setName]=useState("");
  const [age,setAge]=useState("");
  const [magicSent,setMagicSent]=useState(false);
  const [loading,setLoading]=useState(null);
  const [agreed,setAgreed]=useState(false);
  const [showPw,setShowPw]=useState(false);

  const handleSSO=provider=>{
    setLoading(provider);
    setTimeout(()=>{setLoading(null);onAuth({name:"",email:"",provider});},1400);
  };

  const handleEmail=()=>{
    if(!email||(!pw&&view!=="magic"))return;
    if(view==="signup"&&!agreed)return;
    setLoading("email");
    setTimeout(()=>{setLoading(null);onAuth({name:name||"",email,provider:"email"});},1200);
  };

  const handleMagic=()=>{
    if(!email)return;
    setLoading("magic");
    setTimeout(()=>{setLoading(null);setMagicSent(true);},1000);
  };

  if(magicSent)return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,padding:"60px 28px 40px",alignItems:"center",textAlign:"center"}}>
      <div style={{fontSize:56,marginBottom:24}}>📬</div>
      <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1,marginBottom:12}}>Check your inbox</div>
      <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:32}}>We sent a magic link to <strong style={{color:C.t1}}>{email}</strong>. Tap it to sign in instantly — no password needed.</div>
      <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:16,padding:16,width:"100%",marginBottom:24,textAlign:"left"}}>
        <div style={{fontSize:12,color:C.t3,marginBottom:8}}>Didn't receive it? Check your spam folder or</div>
        <button style={{background:"none",border:"none",color:C.accent,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",padding:0}} onClick={()=>{setMagicSent(false);setLoading(null);}}>Resend the magic link →</button>
      </div>
      <button className="bs" onClick={()=>setView("signin")}>← Back to sign in</button>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,overflowY:"auto",scrollbarWidth:"none"}}>
      <div style={{padding:"52px 28px 0",marginBottom:32}}>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.accent,letterSpacing:"-.02em",marginBottom:28}}>reach</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:30,color:C.t1,lineHeight:1.15}}>
          {view==="signin"?"Welcome back."
          :view==="signup"?"Create your account."
          :view==="magic"?"Sign in with email."
          :"Reset your password."}
        </div>
        <div style={{fontSize:13,color:C.t2,marginTop:6}}>
          {view==="signin"?"Sign in to continue planning."
          :view==="signup"?"Join Reach and start planning together."
          :view==="magic"?"We'll send you a one-time sign-in link."
          :"Enter your email address to receive a reset link."}
        </div>
      </div>

      <div style={{padding:"0 28px",flex:1}}>
        {/* SSO Buttons — required by App Store when app offers SSO */}
        {(view==="signin"||view==="signup")&&(
          <>
            {/* Sign in with Apple — REQUIRED on iOS if any social login offered */}
            <button onClick={()=>handleSSO("apple")} style={{width:"100%",padding:"14px 20px",borderRadius:14,border:`1px solid ${C.border}`,background:loading==="apple"?"rgba(255,255,255,.08)":"white",color:"#000",fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10,transition:"opacity .15s",opacity:loading&&loading!=="apple"?.5:1}}>
              {loading==="apple"?<span style={{color:"#000"}}>Signing in…</span>:<><AppleIcon/><span>Continue with Apple</span></>}
            </button>
            {/* Sign in with Google */}
            <button onClick={()=>handleSSO("google")} style={{width:"100%",padding:"14px 20px",borderRadius:14,border:`1px solid ${C.border}`,background:loading==="google"?C.s3:C.s2,color:C.t1,fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:16,transition:"opacity .15s",opacity:loading&&loading!=="google"?.5:1}}>
              {loading==="google"?<span>Signing in…</span>:<><GoogleIcon/><span>Continue with Google</span></>}
            </button>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
              <div style={{flex:1,height:1,background:C.border}}/>
              <span style={{fontSize:12,color:C.t3,fontWeight:500}}>or</span>
              <div style={{flex:1,height:1,background:C.border}}/>
            </div>
          </>
        )}

        {/* Email fields */}
        {view==="signup"&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:12,color:C.t3,marginBottom:6,fontWeight:500}}>Full name</div>
            <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="Full name" autoComplete="name"/>
          </div>
        )}
        {(view==="signin"||view==="signup"||view==="magic"||view==="forgot")&&(
          <div style={{marginBottom:10}}>
            <div style={{fontSize:12,color:C.t3,marginBottom:6,fontWeight:500}}>Email address</div>
            <input className="inp" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email"/>
          </div>
        )}
        {(view==="signin"||view==="signup")&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:C.t3,marginBottom:6,fontWeight:500}}>Password</div>
            <div style={{position:"relative"}}>
              <input className="inp" type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder={view==="signup"?"Minimum 8 characters":"Your password"} autoComplete={view==="signup"?"new-password":"current-password"} style={{paddingRight:48}}/>
              <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.t3,fontSize:13,fontFamily:"'Space Grotesk',sans-serif"}}>{showPw?"Hide":"Show"}</button>
            </div>
          </div>
        )}
        {view==="signup"&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,color:C.t3,marginBottom:6,fontWeight:500}}>Date of birth <span style={{color:C.t4}}>(must be 13 or older)</span></div>
            <input className="inp" type="date" value={age} onChange={e=>setAge(e.target.value)} max={new Date(Date.now()-13*365.25*86400000).toISOString().split("T")[0]} style={{color:age?C.t1:C.t3}}/>
          </div>
        )}

        {/* Forgot password link */}
        {view==="signin"&&(
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
            <button onClick={()=>setView("magic")} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",padding:0}}>Use a magic link instead</button>
            <button onClick={()=>setView("forgot")} style={{background:"none",border:"none",color:C.t3,fontSize:13,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",padding:0}}>Forgot your password?</button>
          </div>
        )}

        {/* Terms checkbox — required by both App Store & Play Store */}
        {view==="signup"&&(
          <div onClick={()=>setAgreed(!agreed)} style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:20,cursor:"pointer",padding:"12px 14px",background:C.s2,borderRadius:12,border:`1px solid ${agreed?C.accentBorder:C.border}`}}>
            <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${agreed?C.accent:C.border}`,background:agreed?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,transition:"all .15s"}}>
              {agreed&&<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
            <div style={{fontSize:12,color:C.t2,lineHeight:1.6}}>
              I agree to Reach's{" "}
              <span style={{color:C.accent,fontWeight:500}}>Terms of Service</span>{" "}and{" "}
              <span style={{color:C.accent,fontWeight:500}}>Privacy Policy</span>.
              I confirm that I am 13 years of age or older.
            </div>
          </div>
        )}

        {/* Primary CTA */}
        {(view==="signin"||view==="signup")&&(
          <button className="bp" onClick={handleEmail} disabled={!email||!pw||(view==="signup"&&!agreed)||loading} style={{marginBottom:10,opacity:!email||!pw||(view==="signup"&&!agreed)?0.4:1}}>
            {loading==="email"?"Signing in…":view==="signin"?"Sign in with email":"Create account"}
          </button>
        )}
        {view==="magic"&&(
          <button className="bp" onClick={handleMagic} disabled={!email||loading} style={{marginBottom:10}}>
            {loading==="magic"?"Sending…":"Send magic link"}
          </button>
        )}
        {view==="forgot"&&(
          <button className="bp" onClick={()=>{setLoading("forgot");setTimeout(()=>{setLoading(null);setView("signin");},1000);}} disabled={!email||loading} style={{marginBottom:10}}>
            {loading==="forgot"?"Sending…":"Send reset link"}
          </button>
        )}

        {/* Toggle signin/signup */}
        <div style={{textAlign:"center",padding:"8px 0 30px"}}>
          {view==="signin"&&<span style={{fontSize:13,color:C.t2}}>Don't have an account? <button onClick={()=>setView("signup")} style={{background:"none",border:"none",color:C.accent,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",fontSize:13}}>Sign up for free</button></span>}
          {view==="signup"&&<span style={{fontSize:13,color:C.t2}}>Already have an account? <button onClick={()=>setView("signin")} style={{background:"none",border:"none",color:C.accent,fontWeight:600,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif",fontSize:13}}>Sign in</button></span>}
          {(view==="magic"||view==="forgot")&&<button onClick={()=>setView("signin")} style={{background:"none",border:"none",color:C.accent,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>← Back to sign in</button>}
        </div>
      </div>
    </div>
  );
}

// ─── PERMISSIONS ONBOARDING ───────────────────────────────────────────────────
// Required by iOS & Android: must explain WHY before requesting system permissions
function PermissionsScreen({onDone}){
  const [step,setStep]=useState(0);
  const perms=[
    {icon:"📍",title:"Location access",why:"Reach shows events and experiences near you, and automatically fills in your departure city when planning trips.",ios:"Allow while using the app",required:false},
    {icon:"🔔",title:"Push notifications",why:"Get real-time updates when your group votes, when approvals are needed, or when bookings are confirmed.",ios:"Allow notifications",required:false},
    {icon:"📅",title:"Calendar access",why:"Reach can check your availability when planning trips and add confirmed bookings directly to your calendar.",ios:"Allow full access",required:false},
    {icon:"👤",title:"Contacts access",why:"Invite friends to groups without typing out email addresses — Reach never stores or uploads your contacts.",ios:"Allow access",required:false},
  ];
  const [granted,setGranted]=useState({});
  const cur=perms[step];
  const isLast=step===perms.length-1;
  const grant=()=>{setGranted(g=>({...g,[step]:true}));isLast?onDone():setStep(s=>s+1);};
  const skip=()=>{setGranted(g=>({...g,[step]:false}));isLast?onDone():setStep(s=>s+1);};
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,padding:"40px 28px"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>
        <div style={{display:"flex",gap:6,marginBottom:40}}>
          {perms.map((_,i)=><div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?C.accent:i<step?C.accentDim:C.s3,transition:"all .3s"}}/>)}
        </div>
        <div style={{width:88,height:88,borderRadius:28,background:C.accentDim,border:`1px solid ${C.accentBorder}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:40,marginBottom:28}}>{cur.icon}</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:26,color:C.t1,marginBottom:12}}>{cur.title}</div>
        <div style={{fontSize:14,color:C.t2,lineHeight:1.7,maxWidth:300,marginBottom:12}}>{cur.why}</div>
        {!cur.required&&<div style={{fontSize:12,color:C.t3,marginBottom:32}}>You can change this at any time in Settings.</div>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <button className="bp" onClick={grant}>Allow {cur.ios}</button>
        {!cur.required&&<button className="bs" onClick={skip} style={{fontSize:14}}>Not now</button>}
      </div>
    </div>
  );
}

// ─── BIOMETRIC / PASSCODE LOCK ────────────────────────────────────────────────
// Required for apps storing financial data (payment methods, bookings)
function BiometricScreen({onDone}){
  const [choice,setChoice]=useState(null);
  const [pin,setPin]=useState("");
  const [confirmPin,setConfirmPin]=useState("");
  const [pinStep,setPinStep]=useState(0); // 0=enter 1=confirm
  const digits="0123456789".split("");
  const addDigit=d=>{
    if(pinStep===0){
      const np=pin+d; setPin(np);
      if(np.length===6){setPinStep(1);}
    } else {
      const np=confirmPin+d; setConfirmPin(np);
      if(np.length===6){
        if(np===pin){setTimeout(onDone,400);}
        else{setConfirmPin("");setPinStep(0);setPin("");}
      }
    }
  };
  const del=()=>{if(pinStep===0)setPin(p=>p.slice(0,-1));else setConfirmPin(p=>p.slice(0,-1));};

  if(choice==="pin")return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,alignItems:"center",padding:"60px 28px 40px"}}>
      <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.accent,marginBottom:40}}>reach</div>
      <div style={{fontFamily:"'Instrument Serif',serif",fontSize:24,color:C.t1,marginBottom:8}}>{pinStep===0?"Create a 6-digit PIN":"Confirm your PIN"}</div>
      <div style={{fontSize:13,color:C.t2,marginBottom:36}}>{pinStep===0?"This PIN protects your payments and bookings.":"Please enter the same PIN again."}</div>
      <div style={{display:"flex",gap:14,marginBottom:48}}>
        {[0,1,2,3,4,5].map(i=><div key={i} style={{width:14,height:14,borderRadius:"50%",background:(pinStep===0?pin:confirmPin).length>i?C.accent:C.s3,border:`2px solid ${(pinStep===0?pin:confirmPin).length>i?C.accent:C.border}`,transition:"all .15s"}}/>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,width:"100%",maxWidth:260}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d==="⌫"?del():d!==""?addDigit(String(d)):null} style={{height:64,borderRadius:16,background:d===""?C.bg:C.s2,border:`1px solid ${d===""?C.bg:C.border}`,color:C.t1,fontSize:d==="⌫"?20:22,fontWeight:500,fontFamily:"'Space Grotesk',sans-serif",cursor:d===""?"default":"pointer",transition:"background .1s"}}>{d}</button>
        ))}
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,padding:"52px 28px 40px"}}>
      <div style={{fontFamily:"'Instrument Serif',serif",fontSize:22,color:C.accent,marginBottom:40}}>reach</div>
      <div style={{flex:1}}>
        <div style={{fontSize:40,marginBottom:20}}>🔐</div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,color:C.t1,marginBottom:10}}>Secure your account</div>
        <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:32}}>Reach stores your payment methods and booking details. Add a layer of protection — required for purchases over $500.</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={()=>{setChoice("bio");setTimeout(onDone,800);}} style={{display:"flex",alignItems:"center",gap:14,padding:"16px 18px",borderRadius:16,border:`2px solid ${C.accentBorder}`,background:C.accentDim,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
            <span style={{fontSize:28}}>🤳</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:15,fontWeight:600,color:C.t1}}>Face ID or Touch ID</div>
              <div style={{fontSize:12,color:C.t2}}>Fastest option — uses your device biometrics</div>
            </div>
            <div style={{marginLeft:"auto",color:C.accent}}>→</div>
          </button>
          <button onClick={()=>setChoice("pin")} style={{display:"flex",alignItems:"center",gap:14,padding:"16px 18px",borderRadius:16,border:`1px solid ${C.border}`,background:C.s2,cursor:"pointer",fontFamily:"'Space Grotesk',sans-serif"}}>
            <span style={{fontSize:28}}>🔢</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontSize:15,fontWeight:600,color:C.t1}}>Set a 6-digit PIN</div>
              <div style={{fontSize:12,color:C.t2}}>Works across all of your devices</div>
            </div>
            <div style={{marginLeft:"auto",color:C.t3}}>→</div>
          </button>
          <button onClick={onDone} style={{background:"none",border:"none",color:C.t3,fontSize:13,cursor:"pointer",padding:"12px 0",fontFamily:"'Space Grotesk',sans-serif"}}>Skip for now (not recommended)</button>
        </div>
      </div>
    </div>
  );
}

// ─── DATA & PRIVACY SCREEN ────────────────────────────────────────────────────
// Required by App Store Review Guideline 5.1 — Privacy
function PrivacyScreen({onDone,user,setUser}){
  const [qStep,setQStep]=useState(0);
  const [answers,setAnswers]=useState({
    vibes:[],        // overall personality/vibe
    foodDrink:[],    // food + drink preferences
    music:[],        // music genres
    noWayJose:[],    // hard vetoes
  });
  const [saving,setSaving]=useState(false);
  const [quizDone,setQuizDone]=useState(false);
  const tog=(k,v)=>setAnswers(a=>({...a,[k]:a[k].includes(v)?a[k].filter(x=>x!==v):[...a[k],v]}));

  const questions=[
    {
      id:"vibes",
      icon:"⚡",
      title:"What's your vibe?",
      sub:"Pick everything that sounds like you.",
      options:[
        {id:"adventure",e:"🧗",l:"Adventurous"},
        {id:"foodie",e:"🍜",l:"Foodie"},
        {id:"nightlife",e:"🌙",l:"Nightlife"},
        {id:"culture",e:"🏛️",l:"Culture & arts"},
        {id:"wellness",e:"🧘",l:"Wellness"},
        {id:"sports",e:"⚽",l:"Sports fan"},
        {id:"nature",e:"🌿",l:"Outdoors & nature"},
        {id:"luxury",e:"💎",l:"Luxury experiences"},
        {id:"budget",e:"💵",l:"Value for money"},
        {id:"spontaneous",e:"🎲",l:"Spontaneous"},
        {id:"planner",e:"📋",l:"Love a good plan"},
        {id:"photography",e:"📸",l:"Aesthetic spots"},
      ]
    },
    {
      id:"foodDrink",
      icon:"🍽️",
      title:"Food & drinks?",
      sub:"Pick everything you're into.",
      options:[
        {id:"japanese",e:"🍣",l:"Japanese"},
        {id:"italian",e:"🍝",l:"Italian"},
        {id:"mexican",e:"🌮",l:"Mexican"},
        {id:"korean",e:"🥩",l:"Korean BBQ"},
        {id:"seafood",e:"🦞",l:"Seafood"},
        {id:"steakhouse",e:"🔥",l:"Steakhouse"},
        {id:"mediterranean",e:"🫒",l:"Mediterranean"},
        {id:"streetFood",e:"🥙",l:"Street food"},
        {id:"cocktails",e:"🍸",l:"Craft cocktails"},
        {id:"wine",e:"🍷",l:"Wine"},
        {id:"beer",e:"🍺",l:"Beer & brews"},
        {id:"spirits",e:"🥃",l:"Whiskey / spirits"},
        {id:"nonAlcoholic",e:"🧃",l:"Non-alcoholic"},
        {id:"vegetarian",e:"🥗",l:"Vegetarian / vegan"},
        {id:"halal",e:"☪️",l:"Halal"},
        {id:"noRestrictions",e:"🤷",l:"No restrictions"},
      ]
    },
    {
      id:"music",
      icon:"🎵",
      title:"What's your music?",
      sub:"Pick everything you actually listen to.",
      options:[
        {id:"hiphop",e:"🎤",l:"Hip-hop / Rap"},
        {id:"rnb",e:"🎙️",l:"R&B / Soul"},
        {id:"pop",e:"⭐",l:"Pop"},
        {id:"afrobeats",e:"🌍",l:"Afrobeats"},
        {id:"latin",e:"💃",l:"Latin / Reggaeton"},
        {id:"electronic",e:"🎛️",l:"Electronic / House"},
        {id:"rock",e:"🎸",l:"Rock / Alternative"},
        {id:"country",e:"🤠",l:"Country"},
        {id:"jazz",e:"🎷",l:"Jazz / Blues"},
        {id:"classical",e:"🎻",l:"Classical"},
        {id:"everything",e:"🎵",l:"Everything hits"},
      ]
    },
    {
      id:"noWayJose",
      icon:"🚫",
      title:"No Way José",
      sub:"Hard vetoes. These will NEVER appear in your plans.",
      noWay:true,
      optional:true,
      options:[
        {id:"camping",e:"⛺",l:"Camping"},
        {id:"cruises",e:"🚢",l:"Cruises"},
        {id:"coldWeather",e:"🥶",l:"Cold weather"},
        {id:"longFlights",e:"✈️",l:"Flights 10+ hrs"},
        {id:"crowded",e:"👥",l:"Touristy spots"},
        {id:"earlyMornings",e:"⏰",l:"Early mornings"},
        {id:"spicy",e:"🌶️",l:"Spicy food"},
        {id:"clubbing",e:"🪩",l:"Clubbing"},
        {id:"hiking",e:"🥾",l:"Hiking"},
        {id:"museums",e:"🏛️",l:"Museums"},
        {id:"gambling",e:"🎰",l:"Gambling"},
        {id:"liveMusic",e:"🔊",l:"Loud live music"},
      ]
    },
  ];

  const q=questions[qStep];
  const isLast=qStep===questions.length-1;
  const canNext=q.optional||(answers[q.id]||[]).length>0;

  const savePrefs=async()=>{
    setSaving(true);
    try{
      const vibes=answers.vibes||[];
      const foodDrink=answers.foodDrink||[];
      const music=answers.music||[];
      const noWay=answers.noWayJose||[];

      // Derive dietary from foodDrink selections
      const dietary=foodDrink.filter(f=>["vegetarian","halal","nonAlcoholic"].includes(f)).join(",");
      const cuisines=foodDrink.filter(f=>!["cocktails","wine","beer","spirits","nonAlcoholic","vegetarian","halal","noRestrictions"].includes(f));
      const drinks=foodDrink.filter(f=>["cocktails","wine","beer","spirits","nonAlcoholic"].includes(f));

      await fetch("/api/user/data",{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          favorite_activities:vibes,
          cuisines,
          music_genres:music,
          drink_style:drinks[0]||null,
          dietary_needs:dietary||"none",
          no_way_jose:noWay,
          consent_personalized:true,
          consent_analytics:true,
          consent_marketing:false,
          budget_range:vibes.includes("luxury")?"luxury":vibes.includes("budget")?"budget":"mid",
          activity_vibe:vibes,
          concert_types:music.map(m=>"music_"+m),
        }),
      });
      if(setUser&&user)setUser(u=>({...u,preferences:{vibes,foodDrink,music,noWayJose:noWay}}));
    }catch(e){console.log("Prefs save failed",e);}
    setSaving(false);
    setQuizDone(true);
  };

  // Quiz complete state - show summary with edit option
  if(quizDone){
    return(
      <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg,alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
        <div style={{width:88,height:88,borderRadius:28,
          background:"linear-gradient(135deg,rgba(124,110,255,0.2),rgba(168,85,247,0.2))",
          border:"1px solid rgba(124,110,255,0.3)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:44,
          marginBottom:20,boxShadow:"0 0 40px rgba(212,168,67,0.15)"}}>
          🎉
        </div>
        <div style={{fontFamily:"'Instrument Serif',serif",fontSize:32,color:C.t1,marginBottom:8,lineHeight:1.1}}>
          You're all set!
        </div>
        <div style={{fontSize:14,color:C.t2,lineHeight:1.7,marginBottom:28,maxWidth:280}}>
          Your preferences are saved. Reach will use them to personalize your recommendations, Discover feed, and trip planning.
        </div>

        {/* Preference summary */}
        <div style={{background:C.s2,border:"1px solid "+C.border,borderRadius:16,padding:16,width:"100%",maxWidth:320,marginBottom:20,textAlign:"left"}}>
          <div style={{fontSize:12,color:C.t3,textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>Your preferences</div>
          {[
            answers.vibes?.length>0&&{icon:"⚡",label:"Vibes",value:answers.vibes.slice(0,3).join(", ")},
            answers.foodDrink?.length>0&&{icon:"🍽️",label:"Food & drinks",value:answers.foodDrink.slice(0,3).join(", ")},
            answers.music?.length>0&&{icon:"🎵",label:"Music",value:answers.music.slice(0,3).join(", ")},
            answers.noWayJose?.length>0&&{icon:"🚫",label:"No Way José",value:answers.noWayJose.slice(0,2).join(", ")},
          ].filter(Boolean).map((row,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
              <span style={{fontSize:16,flexShrink:0}}>{row.icon}</span>
              <div>
                <div style={{fontSize:11,color:C.t3}}>{row.label}</div>
                <div style={{fontSize:13,color:C.t1,fontWeight:500}}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        <button className="bp" style={{width:"100%",maxWidth:320,marginBottom:10}} onClick={onDone}>
          Start exploring →
        </button>
        <button style={{background:"none",border:"none",color:C.accent,fontSize:13,cursor:"pointer",
          fontFamily:"'Space Grotesk',sans-serif",padding:"8px 0"}}
          onClick={()=>{setQuizDone(false);setQStep(0);}}>
          ✏️ Edit my preferences
        </button>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%",background:C.bg}}>
      {/* Progress dots */}
      <div style={{padding:"48px 28px 20px"}}>
        <div style={{display:"flex",gap:6,marginBottom:20,justifyContent:"center"}}>
          {questions.map((_,i)=>(
            <div key={i} style={{width:i===qStep?24:8,height:8,borderRadius:4,
              background:i<qStep?C.accent:i===qStep?C.accent:C.s3,
              transition:"all .3s"}}/>
          ))}
        </div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:44,marginBottom:10}}>{q.icon}</div>
          <div style={{fontFamily:"'Instrument Serif',serif",fontSize:28,
            color:q.noWay?C.red:C.t1,lineHeight:1.2,marginBottom:6}}>
            {q.title}
          </div>
          <div style={{fontSize:14,color:C.t2}}>{q.sub}</div>
          {q.noWay&&(
            <div style={{marginTop:10,padding:"8px 16px",background:"rgba(239,68,68,.08)",
              border:"1px solid rgba(239,68,68,.2)",borderRadius:12,display:"inline-block"}}>
              <div style={{fontSize:12,color:C.red}}>
                🚫 Anything selected will <strong>never</strong> show up in your plans
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Options grid */}
      <div style={{flex:1,overflowY:"auto",scrollbarWidth:"none",padding:"0 20px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,paddingBottom:16}}>
          {q.options.map(opt=>{
            const selected=(answers[q.id]||[]).includes(opt.id);
            const isVeto=q.noWay&&selected;
            return(
              <button key={opt.id} onClick={()=>tog(q.id,opt.id)}
                style={{
                  padding:"14px 8px",borderRadius:14,
                  border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),
                  background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,
                  cursor:"pointer",textAlign:"center",
                  fontFamily:"'Space Grotesk',sans-serif",
                  transition:"all .15s",
                }}>
                <div style={{fontSize:22,marginBottom:4}}>{opt.e}</div>
                <div style={{fontSize:11,fontWeight:600,
                  color:isVeto?"#EF4444":selected?C.accent:C.t1,
                  lineHeight:1.2}}>{opt.l}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected count */}
      {(answers[q.id]||[]).length>0&&(
        <div style={{textAlign:"center",padding:"6px 0",fontSize:12,color:C.accent,fontWeight:500}}>
          {(answers[q.id]||[]).length} selected
        </div>
      )}

      {/* Navigation */}
      <div style={{padding:"12px 28px 44px",display:"flex",gap:10}}>
        {qStep>0&&(
          <button className="bs" style={{flex:1}} onClick={()=>setQStep(s=>s-1)}>← Back</button>
        )}
        {isLast?(
          <button className="bp" style={{flex:2,opacity:saving?.7:1}}
            disabled={saving} onClick={savePrefs}>
            {saving?"Setting up Reach…":"Let's go 🎉"}
          </button>
        ):(
          <button className="bp" style={{flex:2}} disabled={!canNext}
            onClick={()=>setQStep(s=>s+1)}>
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}


