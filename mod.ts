import { delay } from "https://deno.land/std/async/mod.ts";
import {
  WebClient,
  WebAPICallResult,
} from "https://deno.land/x/slack_web_api/mod.ts";

const SLACK_CHANNEL = "#bybit-test";

export const postSlack = async (
  channel: string,
  text: string
): Promise<WebAPICallResult> => {
  const token = Deno.env.get("SLACK_TOKEN");
  const web = new WebClient(token);

  console.log({ channel, text });

  return await web.chat.postMessage({
    channel,
    text,
  });
};
