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
  has_logo: boolean;
  logo_version: number; // changes whenever the logo does
}

export interface BillSummary {
  id: number;
  bill_no: string;
  bill_date: string;
  fy_start: number;
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
}

export interface Bill {
  id: number;
  bill_no: string;
  bill_date: string;
  fy_start: number;
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
