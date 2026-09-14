alter table public.itinerary_items add column if not exists booking_mode text;
alter table public.itinerary_items add column if not exists payment_note text;
