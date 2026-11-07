export interface User {
  id: number;
  username: string;
  full_name: string;
  role: "admin" | "staff";
  is_active?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Client {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  pan: string | null;
  gstin: string | null;
  referred_by: string | null;
  folder_name: string | null;
  is_deleted: boolean;
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  price_paise: number;
  is_active: boolean;
}

export interface Settings {
  org_name: string;
  org_address: string;
  org_gstin: string;
  // Where clients should pay (printed on every bill)
  bank_account_holder: string;
  bank_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  bank_branch: string;
  upi_id: string;
  payment_instructions: string;
  gst_enabled: boolean;
  gst_rate_percent: number;
  /** Days from the bill date to the default due date. */
  payment_terms_days: number;
  /** Put in front of a 10-digit phone number for WhatsApp (91 = India). */
  default_country_code: string;
  has_logo: boolean;
  logo_version: number; // changes whenever the logo does
}

/** open = still owes money; paid = settled by payments; credited = settled by credit notes. */
export type BillState = "open" | "paid" | "credited" | "written_off" | "cancelled";

export interface Settlement {
  paid_paise: number;
  credited_paise: number;
  /** Let go when the client paid less by agreement. Only ever recorded at payment time, never on the bill itself. */
  discount_paise: number;
  balance_paise: number;
  state: BillState;
  part_paid: boolean;
  overdue: boolean;
}

export interface BillSummary extends Settlement {
  id: number;
  bill_no: string;
  bill_date: string;
  due_date: string | null;
  fy_start: number;
  status: "active" | "cancelled";
  total_paise: number;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  client_city: string | null;
  client_deleted: boolean;
}

export interface FinancialYear {
  fy_start: number;
  label: string;
}

export interface BillItem {
  id: number;
  service_id: number | null;
  description: string;
  details: string | null;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
  /** The financial year this line is for (2024 = FY 2024-25), shown on the bill. */
  fy_start: number;
}

export type PaymentMethod = "cash" | "upi" | "bank_transfer" | "cheque" | "card" | "other";

export interface Payment {
  id: number;
  amount_paise: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  created_at: string;
  created_by_name: string;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

export interface Discount {
  id: number;
  amount_paise: number;
  given_on: string;
  reason: string;
  created_at: string;
  created_by_name: string;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

export interface CreditNoteSummary {
  id: number;
  cn_no: string;
  cn_date: string;
  reason: string;
  total_paise: number;
}

export interface HistoryEntry {
  id: number;
  action: "created" | "edited" | "cancelled" | "payment_added" | "payment_voided" | "credit_note_issued";
  summary: string;
  before_data: unknown;
  changed_at: string;
  changed_by_name: string;
}

export interface BillsTotals {
  billed_paise: number;
  credited_paise: number;
  discount_paise: number;
  collected_paise: number;
  outstanding_paise: number;
  outstanding_count: number;
  overdue_paise: number;
  overdue_count: number;
}

export interface BackupStatus {
  enabled: boolean;
  backupDir: string | null;
  canBackUpDatabase: boolean;
  copyDir: string | null;
  lastRunAt: string | null;
  lastDatabaseBackup: string | null;
  lastCopyAt: string | null;
  lastError: string | null;
  running: boolean;
}

export interface Bill extends Settlement {
  id: number;
  bill_no: string;
  bill_date: string;
  due_date: string | null;
  fy_start: number;
  status: "active" | "cancelled";
  cancelled_at: string | null;
  cancel_reason: string | null;
  cancelled_by_name: string | null;
  /** Once a payment or credit note is attached, the client, date and items can no longer be edited. */
  amounts_locked: boolean;
  payments: Payment[];
  credit_notes: CreditNoteSummary[];
  discounts: Discount[];
  notes: string | null;
  subtotal_paise: number;
  gst_rate_percent: number;
  gst_paise: number;
  total_paise: number;
  client_id: number;
  client_name: string;
  client_phone: string | null;
  client_city: string | null;
  client_address: string | null;
  client_gstin: string | null;
  client_pan: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  updated_by_name: string | null;
  items: BillItem[];
}
