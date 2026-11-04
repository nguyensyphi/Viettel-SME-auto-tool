import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: [
    "@am-sme/auth",
    "@am-sme/config",
    "@am-sme/database",
    "@am-sme/domain",
    "@am-sme/excel-import",
  ],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  webpack(webpackConfig) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
