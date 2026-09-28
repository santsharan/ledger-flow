import { JournalDetail } from "@/features/ledger/ledger-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalDetail journalId={id} />;
}
