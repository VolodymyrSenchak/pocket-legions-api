import http from "node:http";
import {ENV_VARIABLES} from "./utils/envVariables";
import {createSupabaseRuntime} from "./runtime";

const runtime = createSupabaseRuntime();
const server = http.createServer(runtime.app);
runtime.attachRealtime(server);

// On Vercel the platform owns the listener; the exported server is the entry.
if (!process.env.VERCEL) {
  server
    .listen(ENV_VARIABLES.port, "localhost", function () {
      console.log(`Server is running on port ${ENV_VARIABLES.port}.`);
    })
    .on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.log("Error: address already in use");
      } else {
        console.log(err);
      }
    });
}

export default server;
