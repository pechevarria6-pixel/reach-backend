import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const cookieNow=()=>{const j=JSON.parse(readFileSync('playwright/.auth/session.json','utf8'));
  return (j.cookies||[]).filter((c:any)=>String(c.domain||'').includes('alcanzar')).map((c:any)=>`${c.name}=${c.value}`).join('; ');};
const refresh=()=>{execSync('npx playwright test --project=setup --reporter=dot',{stdio:'pipe'});return cookieNow();};
const BASE='https://www.alcanzar.io';
const rows=(days:any[],n:boolean)=>{
  const S=n?["To start","The main event","After"]:["Morning","Afternoon","Evening"];
  const L=(d:any,i:number)=>n?S[i]:`Day ${d.day} · ${S[i]}`;
  const kind=(sl:any,fb:string)=>sl.ticket_url?"event":fb;
  const link=(sl:any)=>sl.ticket_url?{venue_website:sl.ticket_url,venue_name:sl.venue||null}
    :(sl.place_url?{venue_website:sl.place_url,venue_name:sl.venue||null}:{});
  return (days||[]).flatMap((day:any)=>{
    const c=Math.round((day.cost_today||0)*100);
    const s=(v:any)=>typeof v==="string"?{plan:v}:(v||{});
    const m=s(day.morning),a=s(day.afternoon),e=s(day.evening);
    const ea=(sl:any)=>sl.cost!=null?Math.round(sl.cost*100):Math.round(c/3);
    return [
      {time:L(day,0),title:m.plan,sub:n?"":(day.title||""),type:kind(m,n?"restaurant":"activity"),cost_cents:ea(m),booking_mode:m.booking||null,payment_note:m.payment||null,because:m.because||null,...link(m)},
      {time:L(day,1),title:a.plan,sub:"",type:kind(a,"activity"),cost_cents:ea(a),booking_mode:a.booking||null,payment_note:a.payment||null,because:a.because||null,...link(a)},
      {time:L(day,2),title:e.plan,sub:day.insider_tip||"",type:kind(e,"restaurant"),cost_cents:ea(e),booking_mode:e.booking||null,payment_note:e.payment||null,because:e.because||null,...link(e)},
    ].filter((r:any)=>r.title);
  });
};
const PLANS=[
 {id:"3d686f65-f696-475f-abd7-bd46ff805bbc",g:"6d21d902-710a-4874-a16b-4548c021612b",t:"The Milk Carton Kids",c:"Washington",k:"US",s:"2026-09-21",e:"2026-09-21",n:true},
 {id:"3a23a47c-d897-4991-ac39-2406a4af1777",g:"53339e6d-301f-4cf3-b867-81b0fdfcd58e",t:"Downtown Raleigh Italian Evening",c:"Raleigh",k:"US",s:"2026-09-25",e:"2026-09-25",n:true},
 {id:"07778625-b64d-44ec-b465-ae4cc7460ced",g:"e233f44a-a5ed-41a2-a710-ada99e16b660",t:"Dinner and Live Jazz in the Warehouse District",c:"Raleigh",k:"US",s:"2026-09-20",e:"2026-09-20",n:true},
 {id:"4fbd6ac9-f396-4b5b-bea6-d34292fd4cb7",g:"2cdc3244-cc85-498f-8fc3-edc5d901582d",t:"Greek Dinner & Jazz at The Pit",c:"Raleigh",k:"US",s:"2026-09-26",e:"2026-09-26",n:true},
 {id:"30c78ed1-b351-4815-9107-a8ffed264348",g:"6d21d902-710a-4874-a16b-4548c021612b",t:"Puerto Vallarta, Mexico",c:"Puerto Vallarta",k:"MX",s:"2026-11-02",e:"2026-11-09",n:false},
 {id:"c2ae9ba4-a0d3-4173-8f2e-4fde0ae3244d",g:"6d21d902-710a-4874-a16b-4548c021612b",t:"Moab, Utah, USA",c:"Moab",k:"US",s:"2026-09-17",e:"2026-09-30",n:false},
];
for (const P of PLANS) {
  let cookie=refresh();
  const res=await fetch(`${BASE}/api/trips/generate`,{method:'POST',headers:{'Content-Type':'application/json',cookie},
    body:JSON.stringify({groupId:P.g,startDate:P.s,endDate:P.e,detailTripId:P.id,mode:P.n?'night':'trip',
      location:P.c,goalBlurb:P.t,tripData:{destination:P.c,city:P.c,country_code:P.k,vibe:null,costs:null}})});
  const d:any=await res.json().catch(()=>({}));
  if(!res.ok){console.log(`${P.t.slice(0,30).padEnd(32)} FAIL ${res.status} ${(d.error||'').slice(0,50)}`);continue;}
  const items=rows(d.itinerary,P.n);
  cookie=refresh();
  const put=await fetch(`${BASE}/api/plans/${P.id}/itinerary`,{method:'PUT',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({items})});
  const links=items.filter((r:any)=>r.venue_website).length;
  console.log(`${P.t.slice(0,30).padEnd(32)} ${put.ok?'saved':'SAVE FAIL'} · ${items.length} rows · ${links} with links · $${Math.round(items.reduce((a:number,r:any)=>a+(r.cost_cents||0),0)/100)}`);
}
