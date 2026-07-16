import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: a stray lockfile at C:\Dev made Turbopack infer the
  // wrong root, which can drop CSS. This forces it to this app directory.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
