import { notFound } from "next/navigation";
import Configurator from "@/components/Configurator";
import { getProduct } from "@/lib/catalog.ts";

export const dynamic = "force-dynamic";

export default async function CreatePage({ params }: { params: Promise<{ code: string }> }) {
  const product = await getProduct((await params).code);
  if (!product) notFound();
  return <Configurator product={product} />;
}
