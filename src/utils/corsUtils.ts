export const CORS_ERROR_MESSAGE = "Not allowed by CORS";

/** Allowed browser origins come only from the `CORS_ORIGINS` env (comma-separated); requests without an Origin always pass. */
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const corsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin || getAllowedOrigins().includes(origin)) {
    callback(null, true); // Allow the request
  } else {
    callback(new Error(CORS_ERROR_MESSAGE)); // Block the request
  }
};

export const getCorsOptions = () => ({
  origin: corsOrigin,
  // the polling fallback reads the ETag to send If-None-Match
  exposedHeaders: ["ETag"],
});
