import Cart from "@/components/Cart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Panier · Carte Blanche" };

export default function CartPage() {
  return (<div className="container"><h1 className="page-title">Votre panier</h1><Cart /></div>);
}
