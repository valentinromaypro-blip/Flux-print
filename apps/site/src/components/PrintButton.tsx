"use client";
export default function PrintButton({ label }: { label: string }) {
  return <button className="btn ghost small" onClick={() => window.print()}>{label}</button>;
}
