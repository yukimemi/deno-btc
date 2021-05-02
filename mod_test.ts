import { assert } from "https://deno.land/std/testing/asserts.ts";
import { postSlack } from "./mod.ts";

const SLACK_CHANNEL = "#bybit-test";

Deno.test("postSlack", async () => {
  const chan = SLACK_CHANNEL;
  const msg = "test message";
  const result = await postSlack(chan, msg);
  assert(result.ok);
});
