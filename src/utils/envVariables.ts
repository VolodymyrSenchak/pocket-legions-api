import dotenv from "dotenv";
import fs from "fs";

// Load .env.local if it exists, otherwise fallback to .env
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else {
  dotenv.config();
}

export const ENV_VARIABLES = {
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
};
