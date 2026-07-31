export type WaLinkRow = {
  id: string;
  slug: string;
  name: string;
  phone: string;          // digits only, incl. country code
  message: string;
  created_at: string;
  // Derived by wa_links_view (never stored):
  click_count: number;
  clicks_24h: number;
  clicks_7d: number;
  last_clicked_at: string | null;
};
