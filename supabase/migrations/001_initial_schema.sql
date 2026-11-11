-- Tales of Biryani — Supabase Schema
-- Migration 001: Core tables with RLS
-- Run against a Supabase project with Firebase as third-party auth provider.

-- ═══════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════
create extension if not exists "uuid-ossp";

-- ═══════════════════════════════════════════
-- PROFILES
-- ═══════════════════════════════════════════
create table public.profiles (
  id         text primary key,                    -- Firebase UID
  name       text,
  phone      text,
  email      text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using ( id = (auth.jwt() ->> 'sub') );

create policy "Users can insert own profile"
  on public.profiles for insert
  with check ( id = (auth.jwt() ->> 'sub') );

create policy "Users can update own profile"
  on public.profiles for update
  using ( id = (auth.jwt() ->> 'sub') );

-- ═══════════════════════════════════════════
-- ADDRESSES
-- ═══════════════════════════════════════════
create table public.addresses (
  id         uuid primary key default uuid_generate_v4(),
  user_id    text not null references public.profiles(id) on delete cascade,
  label      text not null default 'Home',        -- Home, Work, Other
  line1      text not null,
  line2      text,
  city       text not null,
  pincode    text not null,
  lat        double precision,
  lng        double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.addresses enable row level security;

create policy "Users can CRUD own addresses"
  on public.addresses for all
  using ( user_id = (auth.jwt() ->> 'sub') )
  with check ( user_id = (auth.jwt() ->> 'sub') );

-- ═══════════════════════════════════════════
-- OUTLETS
-- ═══════════════════════════════════════════
create table public.outlets (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  address        text not null,
  lat            double precision,
  lng            double precision,
  phone          text,
  opening_hours  jsonb,          -- { "mon": "11:00-23:00", ... }
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.outlets enable row level security;

-- Public read for outlets
create policy "Anyone can read active outlets"
  on public.outlets for select
  using ( is_active = true );

-- ═══════════════════════════════════════════
-- MENU ITEMS
-- ═══════════════════════════════════════════
create table public.menu_items (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  description  text,
  image_url    text,
  base_price   integer not null,          -- in paise (₹)
  category     text not null default 'biryani',
  is_available boolean not null default true,
  is_veg       boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.menu_items enable row level security;

create policy "Anyone can read available items"
  on public.menu_items for select
  using ( is_available = true );

-- ═══════════════════════════════════════════
-- MENU VARIANTS
-- ═══════════════════════════════════════════
create table public.menu_variants (
  id          uuid primary key default uuid_generate_v4(),
  item_id     uuid not null references public.menu_items(id) on delete cascade,
  label       text not null,              -- "Half", "Full", "Chicken", "Mutton"
  price_delta integer not null default 0, -- additional paise over base_price
  is_default  boolean not null default false,
  sort_order  integer not null default 0
);

alter table public.menu_variants enable row level security;

create policy "Anyone can read variants"
  on public.menu_variants for select
  using ( true );

-- ═══════════════════════════════════════════
-- STORY CHAPTERS (CMS-driven scroll content)
-- ═══════════════════════════════════════════
create table public.story_chapters (
  id         uuid primary key default uuid_generate_v4(),
  sort_order integer not null default 0,
  title      text not null,
  subtitle   text,
  body       text,
  media_url  text,
  meta       jsonb,           -- bowl keyframes, particle config overrides
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.story_chapters enable row level security;

create policy "Anyone can read active chapters"
  on public.story_chapters for select
  using ( is_active = true );

-- ═══════════════════════════════════════════
-- ORDERS
-- ═══════════════════════════════════════════
create type public.order_type as enum ('delivery', 'pickup');
create type public.order_status as enum (
  'pending',         -- waiting for payment
  'placed',          -- payment confirmed
  'preparing',       -- kitchen started
  'dum_in_progress', -- biryani is on dum
  'ready',           -- ready for pickup / handoff
  'out_for_delivery',
  'delivered',
  'cancelled'
);

create table public.orders (
  id                uuid primary key default uuid_generate_v4(),
  user_id           text not null references public.profiles(id),
  type              public.order_type not null,
  status            public.order_status not null default 'pending',
  subtotal          integer not null default 0,    -- paise
  tax               integer not null default 0,    -- paise
  delivery_fee      integer not null default 0,    -- paise
  discount          integer not null default 0,    -- paise
  total             integer not null default 0,    -- paise
  address_id        uuid references public.addresses(id),
  outlet_id         uuid references public.outlets(id),
  coupon_code       text,
  notes             text,
  razorpay_order_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "Users can read own orders"
  on public.orders for select
  using ( user_id = (auth.jwt() ->> 'sub') );

create policy "Users can insert own orders"
  on public.orders for insert
  with check ( user_id = (auth.jwt() ->> 'sub') );

-- Only Edge Functions (service_role) can update order status
create policy "Service role can update orders"
  on public.orders for update
  using ( true )
  with check ( true );

-- Enable Realtime for order status tracking
alter publication supabase_realtime add table public.orders;

-- ═══════════════════════════════════════════
-- ORDER ITEMS
-- ═══════════════════════════════════════════
create table public.order_items (
  id         uuid primary key default uuid_generate_v4(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  item_id    uuid not null references public.menu_items(id),
  variant_id uuid references public.menu_variants(id),
  qty        integer not null default 1,
  unit_price integer not null,           -- paise (base + variant delta at time of order)
  created_at timestamptz not null default now()
);

alter table public.order_items enable row level security;

create policy "Users can read own order items"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (auth.jwt() ->> 'sub')
    )
  );

create policy "Users can insert own order items"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (auth.jwt() ->> 'sub')
    )
  );

-- ═══════════════════════════════════════════
-- RESERVATIONS (Dine-In)
-- ═══════════════════════════════════════════
create type public.reservation_status as enum (
  'pending',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show'
);

create table public.reservations (
  id                uuid primary key default uuid_generate_v4(),
  user_id           text not null references public.profiles(id),
  outlet_id         uuid not null references public.outlets(id),
  date              date not null,
  slot              text not null,                 -- "19:00-19:30"
  party_size        integer not null default 2,
  status            public.reservation_status not null default 'pending',
  notes             text,
  deposit_paid      boolean not null default false,
  razorpay_order_id text,
  created_at        timestamptz not null default now()
);

alter table public.reservations enable row level security;

create policy "Users can read own reservations"
  on public.reservations for select
  using ( user_id = (auth.jwt() ->> 'sub') );

create policy "Users can insert own reservations"
  on public.reservations for insert
  with check ( user_id = (auth.jwt() ->> 'sub') );

create policy "Service role can update reservations"
  on public.reservations for update
  using ( true )
  with check ( true );

-- ═══════════════════════════════════════════
-- PAYMENTS
-- ═══════════════════════════════════════════
create type public.payment_status as enum (
  'created',
  'authorized',
  'captured',
  'failed',
  'refunded'
);

create table public.payments (
  id                   uuid primary key default uuid_generate_v4(),
  order_id             uuid references public.orders(id),
  reservation_id       uuid references public.reservations(id),
  razorpay_payment_id  text,
  razorpay_order_id    text,
  razorpay_signature   text,
  amount               integer not null,           -- paise
  status               public.payment_status not null default 'created',
  raw                  jsonb,                      -- full Razorpay response
  created_at           timestamptz not null default now(),

  constraint chk_payment_ref check (
    (order_id is not null and reservation_id is null) or
    (order_id is null and reservation_id is not null)
  )
);

alter table public.payments enable row level security;

create policy "Users can read own payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and o.user_id = (auth.jwt() ->> 'sub')
    )
    or exists (
      select 1 from public.reservations r
      where r.id = payments.reservation_id
        and r.user_id = (auth.jwt() ->> 'sub')
    )
  );

-- Service role inserts/updates payments via Edge Functions
create policy "Service role can manage payments"
  on public.payments for all
  using ( true )
  with check ( true );

-- ═══════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════
create index idx_orders_user       on public.orders(user_id);
create index idx_orders_status     on public.orders(status);
create index idx_order_items_order on public.order_items(order_id);
create index idx_reservations_user on public.reservations(user_id);
create index idx_reservations_date on public.reservations(outlet_id, date);
create index idx_payments_order    on public.payments(order_id);
create index idx_payments_rzp      on public.payments(razorpay_payment_id);
create index idx_addresses_user    on public.addresses(user_id);

-- ═══════════════════════════════════════════
-- SEED DATA: Hero dish
-- ═══════════════════════════════════════════
insert into public.outlets (name, address, lat, lng, phone, opening_hours, is_active) values
  ('Tales of Biryani — Banjara Hills',
   'Road No. 12, Banjara Hills, Hyderabad 500034',
   17.4156, 78.4347, '+919876543210',
   '{"mon":"11:00-23:00","tue":"11:00-23:00","wed":"11:00-23:00","thu":"11:00-23:00","fri":"11:00-23:30","sat":"11:00-23:30","sun":"12:00-23:00"}',
   true);

insert into public.menu_items (name, description, image_url, base_price, category, is_veg, sort_order) values
  ('Nizami Dum Biryani',
   'Slow-cooked with one-year-aged basmati, hand-ground spices, saffron, and tender chicken, sealed with dough for authentic dum.',
   null,
   34900,  -- ₹349
   'biryani',
   false,
   1);

-- Grab the hero item ID for variants
do $$
declare
  hero_id uuid;
begin
  select id into hero_id from public.menu_items where name = 'Nizami Dum Biryani' limit 1;

  insert into public.menu_variants (item_id, label, price_delta, is_default, sort_order) values
    (hero_id, 'Half',    0,     true,  1),
    (hero_id, 'Full',    10000, false, 2),  -- +₹100
    (hero_id, 'Chicken', 0,     true,  3),
    (hero_id, 'Mutton',  8000,  false, 4),  -- +₹80
    (hero_id, 'Veg',     -5000, false, 5);  -- -₹50
end $$;

-- Add-ons
insert into public.menu_items (name, description, base_price, category, is_veg, sort_order) values
  ('Mirchi ka Salan',   'Tangy chilli-peanut gravy, the classic biryani companion.', 9900, 'sides', false, 10),
  ('Dahi Chutney',      'Cool, tempered yoghurt with a hint of mint.',               6900, 'sides', true,  11),
  ('Rumali Roti',       'Paper-thin bread, cooked on an inverted tawa.',             4900, 'breads', true, 12),
  ('Gulab Jamun (2pc)', 'Soft milk-solid dumplings in rose-cardamom syrup.',         7900, 'desserts', true, 20),
  ('Phirni',            'Chilled rice pudding set in earthen bowls.',                8900, 'desserts', true, 21);

-- Default story chapters (CMS content)
insert into public.story_chapters (sort_order, title, subtitle, body) values
  (0, 'Nizami Dum Biryani', 'A Royal Hyderabadi Legacy', 'Crafted with centuries-old traditions from the royal kitchens of the Nizams.'),
  (1, 'The Grain', 'One year aged basmati.', 'We source the finest 1121 basmati, aged for a full year.'),
  (2, 'The Fat', 'Pure ghee, slow-tempered.', 'Aromatic spices bloom in hand-churned desi ghee.'),
  (3, 'The Marinade', 'Hand-ground spices.', 'Saffron threads steeped in warm milk, hand-ground garam masala.'),
  (4, 'The Seal', 'Sealed with dough.', 'A ring of wheat dough seals the lid, trapping every wisp of steam.'),
  (5, 'The Slow Dum', 'Slow cooked on low flame.', 'For forty-five minutes, the handi sits on the gentlest flame.'),
  (6, 'The Reveal', 'Behold.', 'The seal breaks. A cloud of fragrant steam escapes.'),
  (7, 'Begin Your Feast', 'Order now. Delivered to your door.', 'From the royal kitchens to your table.');
