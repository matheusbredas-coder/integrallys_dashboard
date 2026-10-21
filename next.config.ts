import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O cliente do Google Analytics carrega o gRPC, que resolve partes de si mesmo por
  // require dinâmico. Empacotá-lo compila, mas quebra só em produção, na hora da chamada —
  // deixá-lo externo faz o runtime carregá-lo do node_modules, como um Node comum.
  serverExternalPackages: ["@google-analytics/data"],
};

export default nextConfig;
