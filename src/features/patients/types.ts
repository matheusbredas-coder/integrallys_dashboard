export type Row = Record<string, unknown>;
export type ColType = "text" | "int" | "currency" | "date";
export type ColumnDef = { key: string; label: string; type: ColType };
export type PatientSale = { soldAt: string; total: number; valorPago: number; procedimentos: string };
