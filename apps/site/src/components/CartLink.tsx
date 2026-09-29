"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function CartLink() {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    fetch("/api/cart/items").then((r) => r.json()).then((d) => setCount(d.items?.length ?? 0)).catch(() => {});
  }, [pathname]);
  return <Link className="cart-link" href="/panier">Panier<b>{count}</b></Link>;
}
