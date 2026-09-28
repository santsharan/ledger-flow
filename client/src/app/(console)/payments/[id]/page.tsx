import { PaymentDetail } from "@/features/payments/payment-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetail paymentId={id} />;
}
