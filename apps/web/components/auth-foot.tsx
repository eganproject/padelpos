"use client";

import { useBrand } from "./brand-provider";
import { copyrightLine } from "@/lib/brand";

export function AuthFoot() {
  return <p className="auth-foot">{copyrightLine(useBrand())} · Area staf</p>;
}
