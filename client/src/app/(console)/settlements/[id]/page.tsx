import { SettlementDetail } from "@/features/settlements/settlements-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SettlementDetail settlementId={id} />;
}
