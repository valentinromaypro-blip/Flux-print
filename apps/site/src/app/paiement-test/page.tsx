import TestPayment from "@/components/TestPayment";

export default async function Page({ searchParams }: { searchParams: Promise<{ commande?: string }> }) {
  const { commande } = await searchParams;
  return (
    <div className="container" style={{ paddingBlock: 60, maxWidth: 560, display: "grid", gap: 18 }}>
      <h1 style={{ fontSize: 40 }}>Paiement de test</h1>
      <p className="muted">Environnement de développement : aucune carte n&apos;est débitée. En production, cette étape est remplacée par la page de paiement Stripe ou Revolut.</p>
      <TestPayment number={commande ?? ""} />
    </div>
  );
}
