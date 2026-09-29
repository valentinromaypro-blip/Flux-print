export type Pricing = {
  unit: number;
  per_card?: number;
  tiers: [number, number][];
  media?: Record<string, number>;
};

export type OptionSpec = {
  kind: "choice" | "number";
  label: string;
  choices?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  default?: string | number;
};

export type Product = {
  code: string;
  label: string;
  page_count: number;
  shop: {
    title: string;
    tagline: string;
    description: string;
    image: string;
    order?: number;
    pricing: Pricing;
  };
  options: Record<string, OptionSpec>;
  media: { code: string; label: string; description: string }[];
  templates: Record<string, string>;
};

export type ItemStatus =
  | "uploaded" | "checking" | "rejected" | "approved" | "preparing" | "prepared" | "batched" | "failed";

export type Finding = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  page: number | null;
  details: Record<string, unknown>;
};

export type PreflightReport = { passed: boolean; page_count: number; fixes: string[]; findings: Finding[] };

export type OrderItem = {
  id: string;
  order_id: string;
  product_code: string;
  media: string;
  copies: number;
  options: Record<string, string | number>;
  status: ItemStatus;
  preflight_report: PreflightReport | null;
  preview_paths: string[];
  unit_price_cents: number | null;
  total_cents: number | null;
  created_at: string;
};
