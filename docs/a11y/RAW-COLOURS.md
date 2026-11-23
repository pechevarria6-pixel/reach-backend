# Raw colours outside the token files (Task 0, 2026-11-22)

Token files: the `PALETTE` block in `components/reach-app.jsx` (lines 99-172) and `lib/brand.ts`. Everything below is outside them. Comments are skipped.

129 lines in 12 files (87 values sit inside the token files).

| File:line | Colour(s) | Code |
|---|---|---|
| `app/(app)/onboarding/page.tsx:24` | `#EBEFEC, #E4EAE6, #D8DED4, #EC6032, #D24E24, #2A1D06, #142119, #576E61, #5E766A, rgba(236,96,50,.12), rgba(236,96,50,.30), #C0392B` | `.ob{--bg:#EBEFEC;--s2:#E4EAE6;--bd:#D8DED4;--ac:#EC6032;--acd:#D24E24;--on:#2A1D06;--t1:#1` |
| `app/(app)/onboarding/page.tsx:25` | `#2C0E18, #3F1619, #5A2430, #C3A342, #A8892F, #2A1D06, #FEF7D9, #CFC182, #B89A6A, rgba(195,163,66,.14), rgba(195,163,66,.32), #E85D5D` | `:root[data-theme="dark"] .ob{--bg:#2C0E18;--s2:#3F1619;--bd:#5A2430;--ac:#C3A342;--acd:#A8` |
| `app/(legal)/layout.tsx:11` | `#241C10, #63553A, #E5DCCA, #8A6512` | `:root{--lg-bg:${SURFACE.light};--lg-page:${SHELL.light};--lg-ink:#241C10;--lg-mut:#63553A;` |
| `app/(legal)/layout.tsx:12` | `#F3EBD9, #AC9C7E, #332B1B, #DDB259` | `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--lg-bg:${SURFACE.dark` |
| `app/(legal)/layout.tsx:13` | `#F3EBD9, #AC9C7E, #332B1B, #DDB259` | `:root[data-theme="dark"]{--lg-bg:${SURFACE.dark};--lg-page:${SHELL.dark};--lg-ink:#F3EBD9;` |
| `app/invite/[token]/opengraph-image.tsx:23` | `#4A1B20` | `justifyContent: 'center', background: `radial-gradient(circle at 50% 30%, #4A1B20 0%, ${BR` |
| `app/invite/[token]/page.tsx:11` | `#EBEFEC, #F4F7F5, #E4EAE6, #D8DED4, #EC6032, #D24E24, #2A1D06, #2B583B, #142119, #576E61, #5E766A, rgba(236,96,50,.12), rgba(236,96,50,.30)` | `.iv{--bg:#EBEFEC;--s1:#F4F7F5;--s2:#E4EAE6;--bd:#D8DED4;--ac:#EC6032;--acd:#D24E24;--on:#2` |
| `app/invite/[token]/page.tsx:12` | `#2C0E18, #36121B, #3F1619, #5A2430, #C3A342, #A8892F, #2A1D06, #FEF7D9, #CFC182, #B89A6A, rgba(195,163,66,.14), rgba(195,163,66,.32)` | `:root[data-theme="dark"] .iv{--bg:#2C0E18;--s1:#36121B;--s2:#3F1619;--bd:#5A2430;--ac:#C3A` |
| `app/not-found.tsx:22` | `#241C10, #63553A, #E5DCCA, #8A6512` | `:root{--nf-bg:${SURFACE.light};--nf-ink:#241C10;--nf-mut:#63553A;--nf-line:#E5DCCA;--nf-ac` |
| `app/not-found.tsx:23` | `#F3EBD9, #AC9C7E, #332B1B, #DDB259` | `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--nf-bg:${SURFACE.dark` |
| `app/not-found.tsx:24` | `#F3EBD9, #AC9C7E, #332B1B, #DDB259` | `:root[data-theme="dark"]{--nf-bg:${SURFACE.dark};--nf-ink:#F3EBD9;--nf-mut:#AC9C7E;--nf-li` |
| `app/opengraph-image.tsx:20` | `#4A1B20` | `justifyContent: 'center', background: `radial-gradient(circle at 50% 30%, #4A1B20 0%, ${BR` |
| `app/page.tsx:39` | `#DFE5E0, #EBEFEC, #E4EAE6, #D8DED4, #EC6032, #D24E24, #2A1D06, #2B583B, #142119, #576E61, #6B7F72, #B8912A, rgba(236,96,50,.14)` | `.lp{--pg:#DFE5E0;--bg:#EBEFEC;--s2:#E4EAE6;--bd:#D8DED4;--ac:#EC6032;--acd:#D24E24;--on:#2` |
| `app/page.tsx:41` | `#1F080F, #2C0E18, #3F1619, #5A2430, #C3A342, #A8892F, #2A1D06, #FEF7D9, #CFC182, #B89A6A, rgba(195,163,66,.16)` | `:root[data-theme="dark"] .lp{--pg:#1F080F;--bg:#2C0E18;--s2:#3F1619;--bd:#5A2430;--ac:#C3A` |
| `components/ReachApp.tsx:36` | `#241C10` | ``:root{--shell-surface:${SURFACE.light};--shell-ink:#241C10;}`` |
| `components/ThemedAuth.tsx:34` | `#142119` | `.auth-fb{color:#142119}` |
| `components/ThemedAuth.tsx:35` | `#576E61` | `.auth-fb .auth-fb-dim{color:#576E61}` |
| `components/ThemedAuth.tsx:36` | `#FEF7D9` | `:root[data-theme="dark"] .auth-fb{color:#FEF7D9}` |
| `components/ThemedAuth.tsx:37` | `#CFC182` | `:root[data-theme="dark"] .auth-fb .auth-fb-dim{color:#CFC182}` |
| `components/ThemedAuth.tsx:76` | `#D24E24, #EC6032, #2A1D06` | `background: 'linear-gradient(135deg, #D24E24, #EC6032)', color: '#2A1D06',` |
| `components/ThemedAuth.tsx:91` | `#EC6032` | `border: '3px solid #EC6032', borderTopColor: 'transparent', borderRadius: '50%',` |
| `components/ThemedAuth.tsx:141` | `#9A8A6A` | `<div style={{ textAlign: 'center', padding: 24, color: '#9A8A6A', fontSize: 13.5, lineHeig` |
| `components/reach-app.jsx:173` | `rgba(0,0,0,.95)` | `frameShadow: "0 80px 200px rgba(0,0,0,.95)",` |
| `components/reach-app.jsx:174` | `rgba(195,163,66,0.10)` | `frameGlow: "rgba(195,163,66,0.10)",` |
| `components/reach-app.jsx:279` | `rgba(0,0,0,.45), #fff` | `.hd-ov{position:absolute;top:calc(16px + env(safe-area-inset-top));left:16px;width:44px;he` |
| `components/reach-app.jsx:291` | `rgba(255,255,255,.32)` | `.bp{width:100%;min-height:52px;padding:16px 20px;background:linear-gradient(135deg,${C.acc` |
| `components/reach-app.jsx:410` | `#8C6D1F, #9E4B57, #3F7D63, #8A5A2B, #3D6389, #6B4A80, #A0563C, #4A7A52` | `const AVATAR_COLORS = ["#8C6D1F","#9E4B57","#3F7D63","#8A5A2B","#3D6389","#6B4A80","#A0563` |
| `components/reach-app.jsx:1234` | `rgba(0,0,0,.55), rgba(0,0,0,0)` | `background:"linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0))",` |
| `components/reach-app.jsx:1235` | `rgba(255,255,255,.92)` | `fontSize:9.5,lineHeight:1.2,color:"rgba(255,255,255,.92)",` |
| `components/reach-app.jsx:1458` | `rgba(108,99,255,.05)` | `<div style={{margin:"0 20px 14px",background:`linear-gradient(135deg,${C.accentDim},rgba(1` |
| `components/reach-app.jsx:1510` | `#1a1060` | `style={{minWidth:200,background:`linear-gradient(145deg,#1a1060,${C.accent})`,borderRadius` |
| `components/reach-app.jsx:1519` | `rgba(0,0,0,.28), rgba(0,0,0,.78)` | `background:"linear-gradient(160deg,rgba(0,0,0,.28),rgba(0,0,0,.78))"}}/>` |
| `components/reach-app.jsx:1531` | `rgba(255,255,255,.65)` | `<div style={{fontSize:12,color:"rgba(255,255,255,.65)",marginBottom:10}}>{plan.startDate?p` |
| `components/reach-app.jsx:1540` | `rgba(255,255,255,.16)` | `padding:"3px 9px",borderRadius:20,background:"rgba(255,255,255,.16)",` |
| `components/reach-app.jsx:1556` | `rgba(255,255,255,.55)` | `<div style={{fontSize:9.5,color:"rgba(255,255,255,.55)",marginTop:8,lineHeight:1.3}}>` |
| `components/reach-app.jsx:1915` | `rgba(0,0,0,.5), #fff` | `?{background:"rgba(0,0,0,.5)",color:"#fff",backdropFilter:"blur(6px)",WebkitBackdropFilter` |
| `components/reach-app.jsx:1921` | `rgba(0,0,0,.22)` | `borderRadius:14,overflow:"hidden",minWidth:188,boxShadow:"0 10px 28px rgba(0,0,0,.22)"}}>` |
| `components/reach-app.jsx:1990` | `rgba(0,0,0,0), rgba(0,0,0,.6), rgba(0,0,0,.85)` | `const PLACE_SCRIM="linear-gradient(180deg,rgba(0,0,0,0) 0px,rgba(0,0,0,.6) 24px,rgba(0,0,0` |
| `components/reach-app.jsx:2004` | `rgba(255,255,255,.88)` | `const soft=ok?"rgba(255,255,255,.88)":C.t2;` |
| `components/reach-app.jsx:2011` | `#1a1a1a` | `background:ok?"#1a1a1a":DISCOVER_TINT[categoryGroup(exp.category)],overflow:"hidden"}}>` |
| `components/reach-app.jsx:2018` | `#fff` | `{visited&&<span style={{fontWeight:600,color:ok?"#fff":C.t1}}>· ✓ You've been</span>}` |
| `components/reach-app.jsx:2020` | `#fff` | `<span className="dsc-clamp2" style={{...T.title2,color:ok?"#fff":C.t1,marginTop:4}}>{exp.t` |
| `components/reach-app.jsx:2846` | `#1a1060` | `<div style={{height:200,background:exp.bg\|\|`linear-gradient(135deg,#1a1060,${C.accent})`,p` |
| `components/reach-app.jsx:2849` | `rgba(0,0,0,.9)` | `<div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent` |
| `components/reach-app.jsx:2852` | `rgba(255,255,255,.65)` | `<div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginTop:4}}>{exp.sub}</div>` |
| `components/reach-app.jsx:2855` | `rgba(0,0,0,.5)` | `<div style={{position:"absolute",top:16,right:16,background:"rgba(0,0,0,.5)",borderRadius:` |
| `components/reach-app.jsx:3129` | `rgba(108,99,255,.08)` | `<div style={{background:"rgba(108,99,255,.08)",border:"1px solid "+C.accentBorder,borderRa` |
| `components/reach-app.jsx:3281` | `#fff` | `style={{background:C.red,border:"none",color:"#fff",fontSize:12.5,fontWeight:700,padding:"` |
| `components/reach-app.jsx:3285` | `#fff` | `style={{width:WIDTH,background:C.red,border:"none",color:"#fff",fontSize:13,fontWeight:700` |
| `components/reach-app.jsx:5673` | `rgba(239,68,68,.6)` | `border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),` |
| `components/reach-app.jsx:5674` | `rgba(239,68,68,.1)` | `background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,` |
| `components/reach-app.jsx:6471` | `rgba(239,68,68,.08), rgba(239,68,68,.2)` | `background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",` |
| `components/reach-app.jsx:6508` | `rgba(239,68,68,.6)` | `border:"2px solid "+(isVeto?"rgba(239,68,68,.6)":selected?C.accent:C.border),` |
| `components/reach-app.jsx:6509` | `rgba(239,68,68,.1)` | `background:isVeto?"rgba(239,68,68,.1)":selected?C.accentDim:C.s2,` |
| `components/reach-app.jsx:7290` | `rgba(239,68,68,.4)` | `style={{flex:1,padding:"12px 8px",borderRadius:12,border:"1px solid rgba(239,68,68,.4)",` |
| `components/reach-app.jsx:7291` | `rgba(239,68,68,.18), rgba(239,68,68,.08)` | `background:vetoed?"rgba(239,68,68,.18)":"rgba(239,68,68,.08)",color:C.red,fontSize:13,font` |
| `components/reach-app.jsx:8112` | `rgba(212,168,67,0.1), rgba(196,154,56,0.05)` | `<div style={{background:"linear-gradient(135deg,rgba(212,168,67,0.1),rgba(196,154,56,0.05)` |
| `components/reach-app.jsx:8113` | `rgba(212,168,67,0.25)` | `border:"1px solid rgba(212,168,67,0.25)",borderRadius:20,padding:"16px",` |
| `components/reach-app.jsx:8116` | `rgba(212,168,67,0.2), rgba(196,154,56,0.1)` | `background:"linear-gradient(135deg,rgba(212,168,67,0.2),rgba(196,154,56,0.1))",` |
| `components/reach-app.jsx:9404` | `rgba(16,185,129,.30), #ecfdf5` | `"pill-g":{background:"rgba(16,185,129,.30)",color:"#ecfdf5"},` |
| `components/reach-app.jsx:9405` | `rgba(245,158,11,.32), #fffbeb` | `"pill-a":{background:"rgba(245,158,11,.32)",color:"#fffbeb"},` |
| `components/reach-app.jsx:9406` | `rgba(255,255,255,.18)` | `"pill-p":{background:"rgba(255,255,255,.18)",color:"white"},` |
| `components/reach-app.jsx:9554` | `#064E3B` | `background:`linear-gradient(160deg,#064E3B,${C.green})`}}>` |
| `components/reach-app.jsx:9557` | `#FFFFFF, #F472B6` | `background:[C.accent,"#FFFFFF",C.blue,"#F472B6"][i%4],animation:`rfall ${1.8+(i%5)*.3}s ${` |
| `components/reach-app.jsx:9559` | `rgba(255,255,255,.16)` | `<div aria-hidden="true" style={{width:84,height:84,borderRadius:"50%",background:"rgba(255` |
| `components/reach-app.jsx:9562` | `rgba(255,255,255,.8)` | `{sub&&<div style={{fontSize:14.5,color:"rgba(255,255,255,.8)",marginTop:10,maxWidth:320,li` |
| `components/reach-app.jsx:9564` | `rgba(255,255,255,.16)` | `style={{position:"absolute",bottom:"max(28px, env(safe-area-inset-bottom))",background:"rg` |
| `components/reach-app.jsx:11308` | `#fff` | `background:f.done?(u?.color\|\|C.accent):C.s3,color:f.done?"#fff":C.t2,fontSize:13,fontWeigh` |
| `components/reach-app.jsx:11312` | `#fff` | `background:C.green,color:"#fff",fontSize:10,fontWeight:800,display:"flex",alignItems:"cent` |
| `components/reach-app.jsx:12765` | `#1a1060` | `<div style={{background:`linear-gradient(145deg,#1a1060,${C.accent})`,padding:"calc(18px +` |
| `components/reach-app.jsx:12775` | `rgba(255,255,255,.15)` | `<button className="bsm" style={{marginLeft:"auto",background:"rgba(255,255,255,.15)",color` |
| `components/reach-app.jsx:12778` | `rgba(255,255,255,.65)` | `<div style={{fontSize:13,color:"rgba(255,255,255,.65)",marginBottom:12}}>{plan.dates} · {g` |
| `components/reach-app.jsx:12788` | `rgba(255,255,255,.15)` | `{!booked&&<span className="pill" style={{background:"rgba(255,255,255,.15)",color:"white"}` |
| `components/reach-app.jsx:13579` | `rgba(16,185,129,.15), rgba(255,255,255,.08)` | `background:m.ready?"rgba(16,185,129,.15)":"rgba(255,255,255,.08)",` |
| `components/reach-app.jsx:13687` | `rgba(239,68,68,.4)` | `style={{flex:1,padding:"10px 8px",borderRadius:12,border:"1px solid rgba(239,68,68,.4)",` |
| `components/reach-app.jsx:13688` | `rgba(239,68,68,.18), rgba(239,68,68,.08)` | `background:vetoed?"rgba(239,68,68,.18)":"rgba(239,68,68,.08)",color:C.red,fontSize:13,font` |
| `components/reach-app.jsx:14585` | `rgba(16,185,129,.15), rgba(212,175,55,.15), rgba(255,255,255,.08)` | `background:tone==="green"?"rgba(16,185,129,.15)":tone==="gold"?"rgba(212,175,55,.15)":tone` |
| `components/reach-app.jsx:14788` | `rgba(255,255,255,.08)` | `return(<div><div style={{height:8,background:"rgba(255,255,255,.08)",borderRadius:8,overfl` |
| `components/reach-app.jsx:14965` | `#064E3B, #3B2F0B, #7C5A12` | `<div style={{background:celebrate?`linear-gradient(145deg,#064E3B,${C.green})`:`linear-gra` |
| `components/reach-app.jsx:14966` | `rgba(255,255,255,.15)` | `<div style={{width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.15)",disp` |
| `components/reach-app.jsx:14975` | `rgba(255,255,255,.75)` | `<div style={{fontSize:14,color:"rgba(255,255,255,.75)"}}>` |
| `components/reach-app.jsx:15681` | `#E2C35E, #8E99A4` | `const MAP_PIN={upcoming:"#E2C35E",past:"#8E99A4"};` |
| `components/reach-app.jsx:15747` | `#FFF3C4, #C9D1D9` | `const m=L.circleMarker([pin.lat,pin.lng],{radius:upcoming?9:7,weight:2,color:upcoming?"#FF` |
| `components/reach-app.jsx:15774` | `#0E1116` | `<div style={{position:"relative",height:200,borderRadius:16,overflow:"hidden",border:`1px ` |
| `components/reach-app.jsx:15778` | `rgba(14,17,22,.45)` | `background:"rgba(14,17,22,.45)"}}>` |
| `components/reach-app.jsx:15779` | `#F2F2F2` | `<div style={{color:"#F2F2F2",fontFamily:"var(--font-display)",fontSize:20,textAlign:"cente` |
| `components/reach-app.jsx:15782` | `#B8C0C8` | `{!pins&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justif` |
| `components/reach-app.jsx:17562` | `#418, #423, #425` | `#418/#423/#425. Same fault as the auth screens had; this is the rest` |
| `components/reach-app.jsx:17639` | `#4285F4` | `<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.` |
| `components/reach-app.jsx:17640` | `#34A853` | `<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71` |
| `components/reach-app.jsx:17641` | `#FBBC05` | `<path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C` |
| `components/reach-app.jsx:17642` | `#EA4335` | `<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 ` |
| `lib/clerk-appearance.ts:37` | `#EBEFEC, #E4EAE6, #D8DED4` | `bg: '#EBEFEC', s2: '#E4EAE6', border: '#D8DED4',` |
| `lib/clerk-appearance.ts:38` | `#EC6032, #D24E24, #2B583B, #2A1D06` | `accent: '#EC6032', accentDeep: '#D24E24', accentText: '#2B583B', onAccent: '#2A1D06',` |
| `lib/clerk-appearance.ts:39` | `#142119, #576E61` | `t1: '#142119', t2: '#576E61',` |
| `lib/clerk-appearance.ts:40` | `#C0392B, #2F7D43, #6F4B00` | `danger: '#C0392B', success: '#2F7D43', warning: '#6F4B00',` |
| `lib/clerk-appearance.ts:41` | `rgba(30,50,38,.16)` | `shadow: '0 24px 80px rgba(30,50,38,.16)',` |
| `lib/clerk-appearance.ts:52` | `#E85D5D, #7FB58A, #E8A33D` | `danger: '#E85D5D', success: '#7FB58A', warning: '#E8A33D',` |
| `lib/clerk-appearance.ts:53` | `rgba(0,0,0,.6)` | `shadow: '0 24px 80px rgba(0,0,0,.6)',` |
| `lib/email.ts:35` | `#241C10` | `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;marg` |
| `lib/email.ts:36` | `#8A6512` | `<div style="font-size:20px;letter-spacing:-.01em;margin-bottom:20px;color:#8A6512;">reach<` |
| `lib/email.ts:39` | `#7E6F52, #E5DCCA` | `<p style="color:#7E6F52;font-size:12.5px;line-height:1.6;margin-top:28px;border-top:1px so` |
| `lib/email.ts:40` | `#8A6512` | `Sent by Reach &middot; <a href="https://www.alcanzar.io" style="color:#8A6512;">alcanzar.i` |
| `lib/email.ts:74` | `#635539` | `<tr><td style="padding:8px 0;color:#635539;">Amount</td><td style="padding:8px 0;text-alig` |
| `lib/email.ts:75` | `#635539` | `<tr><td style="padding:8px 0;color:#635539;">Trip</td><td style="padding:8px 0;text-align:` |
| `lib/email.ts:76` | `#635539` | `<tr><td style="padding:8px 0;color:#635539;">Reference</td><td style="padding:8px 0;text-a` |
| `lib/email.ts:78` | `#635539` | `<p style="font-size:14px;color:#635539;line-height:1.6;margin-top:16px;">` |
| `lib/email.ts:91` | `#635539` | `<p style="font-size:14px;color:#635539;line-height:1.6;margin:0 0 20px;">` |
| `lib/email.ts:114` | `#635539` | `<p style="font-size:14px;color:#635539;line-height:1.6;margin:0 0 20px;">` |
| `lib/email.ts:131` | `#635539` | `${list ? `<ul style="font-size:14px;color:#635539;margin:0 0 20px;padding-left:20px;">${li` |
| `lib/email.ts:152` | `#635539` | `<p style="font-size:14px;line-height:1.6;color:#635539;margin:0 0 20px;">` |
| `lib/email.ts:169` | `#EFE8DA` | `<td style="padding:10px 0;border-bottom:1px solid #EFE8DA;">` |
| `lib/email.ts:171` | `#635539` | `${i.detail ? `<div style="font-size:13px;color:#635539;margin-top:2px;">${escape(i.detail)` |
| `lib/email.ts:173` | `#EFE8DA, #635539` | `<td style="padding:10px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-family:mon` |
| `lib/email.ts:208` | `#635539` | `<p style="font-size:14px;color:#635539;line-height:1.6;">` |
| `lib/email.ts:223` | `#7E6F52` | `<p style="color:#7E6F52;font-size:13px;line-height:1.6;margin-top:18px;">` |
| `lib/email.ts:250` | `#635539` | `const plus = gaps ? ` <span style="font-size:12px;font-weight:400;color:#635539;">+ ${gaps` |
| `lib/email.ts:254` | `#EFE8DA` | `<td style="padding:8px 0;border-bottom:1px solid #EFE8DA;">` |
| `lib/email.ts:256` | `#635539` | `${f.detail ? `<div style="font-size:12px;color:#635539;margin-top:1px;">${escape(f.detail)` |
| `lib/email.ts:257` | `#635539` | `<div style="font-size:12px;color:#635539;margin-top:2px;">${escape(f.state)}</div>` |
| `lib/email.ts:259` | `#EFE8DA` | `<td style="padding:8px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-size:14px;w` |
| `lib/email.ts:268` | `#EFE8DA` | `<td style="padding:8px 0;border-bottom:1px solid #EFE8DA;">` |
| `lib/email.ts:269` | `#7E6F52` | `<div style="font-size:11px;color:#7E6F52;text-transform:uppercase;letter-spacing:.06em;">$` |
| `lib/email.ts:271` | `#8A5A0B, #635539, #128181` | `${d.payment ? `<div style="font-size:12px;margin-top:2px;color:${cash ? '#8A5A0B' : '#6355` |
| `lib/email.ts:273` | `#EFE8DA` | `<td style="padding:8px 0;border-bottom:1px solid #EFE8DA;text-align:right;font-size:14px;w` |
| `lib/email.ts:279` | `#635539` | `<p style="font-size:13px;color:#635539;margin:0 0 24px;">${escape(opts.groupName)}</p>` |
| `lib/email.ts:283` | `#635539` | `<p style="font-size:12.5px;color:#635539;margin:0 0 8px;">${opts.memberCount > 1` |
| `lib/email.ts:290` | `#635539` | `<p style="font-size:12.5px;color:#635539;margin:0 0 8px;">What you spend as you go. Estima` |
| `lib/email.ts:294` | `#241C10` | `<table style="width:100%;border-collapse:collapse;border-top:2px solid #241C10;">` |
