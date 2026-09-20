-- ─── What we actually checked, and what we only wrote ───────────────────
-- An itinerary names real places and states things about them. Until now
-- nothing recorded whether any of it had been checked, so a generated line
-- and a verified one looked identical on screen — and the generated ones
-- were stating payment policies with nothing behind them.
--
-- Measured on the Moab plan before this existed, against OpenStreetMap and
-- Wikivoyage:
--
--   Antica Forma        on the map   +1 435 355 0167   payment: nothing recorded
--   Milt's Stop & Eat   on the map   +1-435-259-7424   payment: nothing recorded
--   Moab Brewery        on the map   +1 435 2596333    payment: nothing recorded
--   Pasta Jay's         on the map   +1 435-259-2900   payment: nothing recorded
--   El Charro Loco      not on the map
--   Peace Tree Juice    not on the map
--
-- Four of six confirmed. Zero payment policies confirmed, against an
-- itinerary that asserted three of them.
--
-- So these columns exist to keep the two kinds of statement apart for good.

alter table itinerary_items
  -- null means nobody has checked this item yet, which is the honest state
  -- for everything written before today.
  add column if not exists verified_at timestamptz,
  -- 'confirmed' | 'not_found' | 'unchecked'
  --
  -- 'not_found' means not on the map within five miles of the town centre —
  -- the largest box Overpass will answer for. It is enough to stop Reach
  -- repeating a claim. It is not grounds for telling a traveller their
  -- restaurant is not real, and nothing does.
  add column if not exists verified_status text,
  -- The name as the source spells it, which is often not how it was written.
  add column if not exists venue_name text,
  -- A number somebody can ring. The single most useful verified fact there is.
  add column if not exists venue_phone text,
  add column if not exists venue_website text,
  -- What a traveller who went there actually said, with whose words they are.
  add column if not exists venue_note text,
  add column if not exists venue_note_credit text,
  -- Which source each of the above came from, so any claim can be traced
  -- back to something that said it.
  add column if not exists verified_source text,
  -- Where the old generated payment claims go. Moved rather than deleted:
  -- they are wrong to show and they are still evidence — they are the record
  -- of what the product was telling people, and some of them will turn out
  -- to have been right, which is worth knowing when the checking gets better.
  add column if not exists payment_note_unverified text;

-- The verification pass walks the items nobody has checked, oldest first.
create index if not exists itinerary_items_unverified_idx
  on itinerary_items (verified_at nulls first);

-- Everything already stored was written by a model and checked by nobody.
-- Marking it rather than trusting it: the pass will pick these up, and until
-- it does the screen knows not to present them as established.
update itinerary_items
   set verified_status = 'unchecked'
 where verified_status is null;

-- And the claims that started this. A payment note on an unverified item is
-- a sentence this app cannot stand behind, and leaving it up while the rest
-- of the work lands keeps somebody walking towards a till on our word.
--
-- Set aside, not destroyed, and only where nothing has been checked — an
-- item the pass has already verified keeps the note the pass gave it.
-- Re-running this is safe: the second run finds nothing left to move.
update itinerary_items
   set payment_note_unverified = payment_note,
       payment_note = null
 where verified_at is null
   and payment_note is not null
   and payment_note_unverified is null;
