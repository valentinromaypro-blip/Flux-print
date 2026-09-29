"use client";
import { useState } from "react";

export default function TestPayment({ number }: { number: string }) {
  const [error, setError] = useState("");
  async function pay() {
    const res = await fetch("/api/payments/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ number }) });
    if (res.ok) window.location.href = `/commande/${number}?paiement=ok`;
    else setError((await res.json()).error);
  }
  return (<><button className="btn red" onClick={pay}>Simuler un paiement accepté · commande {number}</button>{error && <p className="error-text">{error}</p>}</>);
}
