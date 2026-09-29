import type { NextConfig } from "next";

const config: NextConfig = {
  // Les fichiers clients (PDF) peuvent être lourds : le dépôt local passe par une route dédiée.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  images: { unoptimized: true },
};

export default config;
