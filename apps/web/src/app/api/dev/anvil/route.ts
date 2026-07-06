import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Dev-only endpoint — returns deployed Anvil test token addresses so the
// frontend panel can show them without hardcoding. 404s in production.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Dev only" }, { status: 404 });
  }

  const addrFile = resolve(process.cwd(), "../../contracts/out/anvil-addresses.json");
  if (!existsSync(addrFile)) {
    return NextResponse.json({ error: "Run pnpm anvil:setup first" }, { status: 404 });
  }

  return NextResponse.json(JSON.parse(readFileSync(addrFile, "utf8")));
}
