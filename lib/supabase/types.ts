// Auto-maintained types matching supabase/migrations/001_initial_schema.sql
// Regenerate with: supabase gen types typescript --local > lib/supabase/types.ts

export type PlanTier = 'free' | 'family'
export type MemberRole = 'owner' | 'co_owner' | 'trusted_contact' | 'heir'
export type AssetType =
  | 'bank_account'
  | 'fixed_deposit'
  | 'mutual_fund'
  | 'insurance'
  | 'property_urban'
  | 'locker'
  | 'loan_taken'
  | 'other'
export type AssetStatus = 'active' | 'dormant' | 'closed'
export type ReminderType = 'fd_maturity' | 'premium_due' | 'emi' | 'doc_expiry'
export type TriggerType = 'death' | 'deadmans_switch'
export type TriggerState =
  | 'armed'
  | 'triggered'
  | 'contesting'
  | 'released'
  | 'dismissed'
  | 'cancelled'

export interface Database {
  public: {
    Tables: {
      families: {
        Row: {
          id: string
          plan_tier: PlanTier
          created_at: string
          dpdp_consent_version: string | null
        }
        Insert: {
          id?: string
          plan_tier?: PlanTier
          created_at?: string
          dpdp_consent_version?: string | null
        }
        Update: {
          plan_tier?: PlanTier
          dpdp_consent_version?: string | null
        }
      }

      members: {
        Row: {
          id: string
          family_id: string
          phone_e164: string
          email: string | null
          role: MemberRole
          public_key: string | null
          pwhash_salt: string | null
          kyc_status: string
          created_at: string
        }
        Insert: {
          id: string            // must equal auth.uid()
          family_id: string
          phone_e164: string
          email?: string | null
          role: MemberRole
          public_key?: string | null
          pwhash_salt?: string | null
          kyc_status?: string
          created_at?: string
        }
        Update: {
          email?: string | null
          role?: MemberRole
          public_key?: string | null
          pwhash_salt?: string | null
          kyc_status?: string
        }
      }

      member_keys: {
        Row: {
          member_id: string
          wrapped_family_key: string
          recovery_method: string
        }
        Insert: {
          member_id: string
          wrapped_family_key: string
          recovery_method?: string
        }
        Update: {
          wrapped_family_key?: string
          recovery_method?: string
        }
      }

      assets: {
        Row: {
          id: string
          family_id: string
          type: AssetType
          encrypted_blob: string   // JSON {ciphertext, nonce}
          search_hash: string | null
          est_value_bucket: string | null
          status: AssetStatus
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          family_id: string
          type: AssetType
          encrypted_blob: string
          search_hash?: string | null
          est_value_bucket?: string | null
          status?: AssetStatus
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          encrypted_blob?: string
          search_hash?: string | null
          est_value_bucket?: string | null
          status?: AssetStatus
          updated_at?: string
        }
      }

      asset_nominees: {
        Row: {
          asset_id: string
          member_id: string
          percentage: number | null
          is_legal_heir: boolean
        }
        Insert: {
          asset_id: string
          member_id: string
          percentage?: number | null
          is_legal_heir?: boolean
        }
        Update: {
          percentage?: number | null
          is_legal_heir?: boolean
        }
      }

      documents: {
        Row: {
          id: string
          asset_id: string
          r2_key: string
          encrypted_doc_key: string
          mime: string
          size_bytes: number
          sha256: string
          created_at: string
        }
        Insert: {
          id?: string
          asset_id: string
          r2_key: string
          encrypted_doc_key: string
          mime: string
          size_bytes: number
          sha256: string
          created_at?: string
        }
        Update: never
      }

      reminders: {
        Row: {
          id: string
          family_id: string
          asset_id: string | null
          type: ReminderType
          due_date: string
          notified_60: boolean
          notified_30: boolean
          notified_7: boolean
          created_at: string
        }
        Insert: {
          id?: string
          family_id: string
          asset_id?: string | null
          type: ReminderType
          due_date: string
          notified_60?: boolean
          notified_30?: boolean
          notified_7?: boolean
          created_at?: string
        }
        Update: {
          notified_60?: boolean
          notified_30?: boolean
          notified_7?: boolean
        }
      }

      triggers: {
        Row: {
          id: string
          family_id: string
          type: TriggerType
          state: TriggerState
          evidence_ref: string | null
          contest_deadline: string | null
          initiated_by: string | null
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          family_id: string
          type: TriggerType
          state?: TriggerState
          evidence_ref?: string | null
          contest_deadline?: string | null
          initiated_by?: string | null
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          state?: TriggerState
          evidence_ref?: string | null
          contest_deadline?: string | null
          resolved_at?: string | null
        }
      }

      audit_log: {
        Row: {
          id: string
          family_id: string
          actor_id: string | null
          action: string
          target_type: string | null
          target_id: string | null
          ts: string
        }
        Insert: {
          id?: string
          family_id: string
          actor_id?: string | null
          action: string
          target_type?: string | null
          target_id?: string | null
          ts?: string
        }
        Update: never
      }

      consents: {
        Row: {
          id: string
          member_id: string
          scope: string
          version: string
          granted_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          member_id: string
          scope: string
          version: string
          granted_at?: string
          revoked_at?: string | null
        }
        Update: {
          revoked_at?: string | null
        }
      }

      subscriptions: {
        Row: {
          id: string
          family_id: string
          plan: string
          status: string
          period_end: string | null
          razorpay_ref: string | null
          created_at: string
        }
        Insert: {
          id?: string
          family_id: string
          plan?: string
          status?: string
          period_end?: string | null
          razorpay_ref?: string | null
          created_at?: string
        }
        Update: {
          plan?: string
          status?: string
          period_end?: string | null
          razorpay_ref?: string | null
        }
      }
    }

    Functions: {
      get_my_family_id: {
        Args: Record<string, never>
        Returns: string
      }
    }
  }
}
