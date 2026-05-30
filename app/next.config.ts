import type { NextConfig } from "next";
import { execSync } from "child_process";

function getBuildNumber(): string {
  try {
    return execSync("git rev-list --count HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "0";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_NR: getBuildNumber(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 16).replace("T", " "),
  },
};

export default nextConfig;
