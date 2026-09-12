import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const apiDir = fileURLToPath(new URL("../", import.meta.url));
config({ path: path.resolve(apiDir, "../../.env"), quiet: true });
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(apiDir, "data"));
export const production = process.env.NODE_ENV === "production";
export const venueTimezone = process.env.VENUE_TIMEZONE || "Asia/Jakarta";
new Intl.DateTimeFormat("en", { timeZone: venueTimezone });

