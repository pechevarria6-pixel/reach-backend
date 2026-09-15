// ─── Days, not one long list ──────────────────────────────────────────────
// The itinerary tab rendered every slot of every day as one flat scroll. On
// a week away that is twenty-four rows with nothing separating Tuesday from
// Friday, and on the Tuesday itself you are scrolling past three days you
// have already had to find lunch.
//
// Each row already carries "Day 3 · Morning", and the plan knows when it
// starts, so the day a row belongs to and the date it falls on are both
// recoverable without changing how anything is stored.
export interface ItineraryRow { time?: string; [k: string]: unknown }

export interface ItineraryDay {
  key: string; n: number; label: string; dateLabel: string;
  isToday: boolean; isPast: boolean; items: ItineraryRow[];
}

/** `now` is injectable so a test can stand on a fixed day. */
export function itineraryDays(
  itinerary: ItineraryRow[] | null | undefined,
  startDate?: string | null,
  now: Date = new Date(),
): ItineraryDay[] {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const start=startDate?new Date(startDate+"T00:00:00"):null;
  const groups: ItineraryDay[] = [];
  const index = new Map<string, ItineraryDay>();
  for(const item of itinerary||[]){
    const m=/^Day (\d+)/.exec(item.time||"");
    const key=m?`day-${m[1]}`:"before";
    if(!index.has(key)){
      const n=m?parseInt(m[1],10):0;
      let date: Date | null = null;
      if(start&&n>0){date=new Date(start);date.setDate(date.getDate()+n-1);}
      const group={
        key,n,
        label:m?`Day ${n}`:"Before you go",
        dateLabel:date?date.toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"}):"",
        isToday:!!date&&date.getTime()===today.getTime(),
        isPast:!!date&&date.getTime()<today.getTime(),
        items:[],
      };
      index.set(key,group);groups.push(group);
    }
    index.get(key)!.items.push(item);
  }
  return groups;
}

