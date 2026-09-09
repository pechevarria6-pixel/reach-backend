export type User = {
  id: string;
  clerk_id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  auth_provider: 'email' | 'apple' | 'google';
  date_of_birth: string | null;
  is_minor: boolean | null;
  stripe_customer_id: string | null;
  passport_number_enc: string | null;
  tsa_precheck_enc: string | null;
  global_entry_enc: string | null;
  seat_preference: string;
  dietary_needs: string;
  climate_preference: string;
  consent_personalized: boolean;
  consent_analytics: boolean;
  consent_marketing: boolean;
  consent_third_party: boolean;
  consent_recorded_at: string;
  deletion_requested_at: string | null;
  deletion_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Group = {
  id: string;
  name: string;
  emoji: string;
  created_by: string | null;
  wallet_balance_cents: number;
  created_at: string;
  updated_at: string;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
};

export type Plan = {
  id: string;
  group_id: string;
  title: string;
  type: 'trip' | 'restaurant' | 'concert' | 'weekend';
  status: 'planning' | 'voting' | 'approved' | 'booked' | 'completed' | 'cancelled';
  start_date: string | null;
  end_date: string | null;
  budget_cents: number;
  accommodation: string | null;
  vibe: string | null;
  destination_style: string | null;
  dealbreakers: string[];
  vote_options: string[];
  created_by: string | null;
  approved_at: string | null;
  booked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Vote = {
  id: string;
  plan_id: string;
  user_id: string;
  option: string;
  voted_at: string;
};

export type ItineraryItem = {
  id: string;
  plan_id: string;
  type: 'flight' | 'hotel' | 'activity' | 'restaurant' | 'transport';
  title: string;
  subtitle: string | null;
  scheduled_time: string | null;
  confirmation_number: string | null;
  is_confirmed: boolean;
  booking_source: string | null;
  cost_cents: number;
  sort_order: number;
  created_at: string;
};

export type Payment = {
  id: string;
  plan_id: string | null;
  user_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_refund_id: string | null;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';
  split_method: 'personal' | 'wallet' | 'split' | null;
  mfa_verified: boolean;
  refund_amount_cents: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  user_id: string | null;
  action: string;
  resource: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};
