import {
  WebClient,
  WebAPICallResult,
} from "https://deno.land/x/slack_web_api/mod.ts";

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
