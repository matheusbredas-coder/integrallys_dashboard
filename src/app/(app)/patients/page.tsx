import { getPatientsData } from "@/features/patients/data";
import { buildColumns } from "@/features/patients/columns";
import { PatientsTable } from "@/features/patients/patients-table";

export default async function PatientsPage() {
  const { patients, salesByPatient } = await getPatientsData();
  const columns = buildColumns(patients);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Patients</h1>
      <PatientsTable columns={columns} rows={patients} salesByPatient={salesByPatient} />
    </div>
  );
}
