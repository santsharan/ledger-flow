import { CaseDetail } from "@/features/reconciliation/reconciliation-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetail caseId={id} />;
}
