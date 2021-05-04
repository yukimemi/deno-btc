import * as ccxt from "https://esm.sh/ccxt";
import { postSlack } from "./mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 10_000;
const DELAY_INTERVAL = 10_000;
const LEVERAGE = 1.5;
const TRAILING_STOP = 50;
const TAKE_PROFIT = TRAILING_STOP * 2.0;
const STOP_LOSS = TRAILING_STOP * 4;
const INTERVAL = 5;
const PER_PAGE = 199;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";

const main = async () => {
  const ec = new Bybit(apiKey, secret, testnet);
  let timer = 0;
  try {
    ec.logBalanceInterval("BTC", FETCH_BALANCE_INTERVAL);

    await delay(5_000);

    ec.onOpens.push((ev) => console.log("OPEN:", { ev }));
    ec.onCloses.push((ev) => console.log("CLOSE:", { ev }));
    ec.onErrors.push((ev) => {
      console.error({ ev });
      throw `Error message: ${(ev as ErrorEvent).message}`;
    });
    ec.onMessages.push((message) => {
      const id = ec.ec.market(BTCUSD).id;
      if (message.topic === `orderBookL2_25.${id}`) {
        const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
        console.log({ prices });
      }
    });

    await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
    timer = ec.startHeartBeat(JSON.stringify({ op: "ping" }), 30_000);
    await ec.subscribeOrderBookL2_25(BTCUSD);
  } catch (e) {
    console.error({ e });
    clearInterval(timer);
    if (ec.ws.readyState !== WebSocket.CLOSED) {
      ec.ws.close();
    }
    console.log("catch");
    await delay(30_000);
    await main();
  }
};

await main();
