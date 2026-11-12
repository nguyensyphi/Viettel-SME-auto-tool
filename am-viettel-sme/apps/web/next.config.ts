import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: [
    "@am-sme/auth",
    "@am-sme/config",
    "@am-sme/database",
    "@am-sme/domain",
    "@am-sme/excel-import",
  ],
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "playwright-core",
    "chromium-bidi",
  ],
  poweredByHeader: false,
  webpack(webpackConfig, { isServer }) {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      "chromium-bidi": false,
      "chromium-bidi/lib/cjs/bidiMapper/BidiMapper": false,
    };
    if (isServer) {
      webpackConfig.externals = [
        ...(Array.isArray(webpackConfig.externals)
          ? webpackConfig.externals
          : [webpackConfig.externals].filter(Boolean)),
        "playwright-core",
      ];
    }
    return webpackConfig;
  },
};

export default config;
