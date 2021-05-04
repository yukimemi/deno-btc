import { DenonConfig } from "https://deno.land/x/denon/mod.ts";

const config: DenonConfig = {
  scripts: {
    start: {
      cmd: "deno run --unstable -A index.ts",
      desc: "run my index.ts file",
    },
    test: {
      cmd: "deno test --unstable -A",
      desc: "test all files",
    },
  },
};

export default config;

