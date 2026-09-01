import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Vercel exposes the deployed commit as VERCEL_GIT_COMMIT_SHA at build
    // time, but only NEXT_PUBLIC_ variables are inlined into the browser
    // bundle — and the browser is where the error tracker runs. Mapping it here
    // means releases are tagged automatically, with nothing to set by hand and
    // nothing to forget on the next deploy. Locally it is simply undefined.
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

export default nextConfig;
