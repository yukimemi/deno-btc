import * as log from "https://deno.land/std/log/mod.ts";
import { Bybit } from "./bybit.ts";
import { Exchange } from "./exchange.ts";
import { assert, assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const PER_PAGE = 199;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";

const ec: Exchange = new Bybit(apiKey, secret, testnet);

Deno.test("loadMarkets #1", async () => {
  const markets = await ec.loadMarkets();
  console.log({ markets });
});

Deno.test("fetchTicker #1", async () => {
  const ticker = await ec.fetchTicker(ec.BTC);
  assert(ticker.ask > 50000);
  assert(ticker.bid > 50000);
});

Deno.test("fetchTicker #2", async () => {
  const ticker = await ec.fetchTicker(ec.XRP);
  assert(ticker.ask > 1);
  assert(ticker.bid > 1);
});

Deno.test("fetchTickers #1", async () => {
  const tickers = await ec.fetchTickers([ec.BTC, ec.XRP]);
  assert(tickers[ec.BTC].ask > 50000);
  assert(tickers[ec.BTC].bid > 50000);
  assert(tickers[ec.XRP].ask > 1);
  assert(tickers[ec.XRP].bid > 1);
});

Deno.test("fetchOHLCV #1", async () => {
  const times = 30;
  const since = ec.ec.milliseconds() - 1000 * 60 * times;
  const timeframe = "1m";
  const ohlcv = await ec.fetchOHLCV(ec.BTC, timeframe, since);
  assertEquals(ohlcv.length, times);
});

Deno.test("fetchOHLCV #2", async () => {
  const times = 60;
  const since = ec.ec.milliseconds() - 1000 * 60 * 60 * times;
  const timeframe = "1h";
  const ohlcv = await ec.fetchOHLCV(ec.BTC, timeframe, since);
  assertEquals(ohlcv.length, times);
});

Deno.test("fetchPrices #1", async () => {
  const prices = await ec.fetchPrices(ec.BTC);
  console.log({ prices });
  assert(prices.ask > 50000);
  assert(prices.bid > 50000);
  assert(prices.spread < 5);
});

Deno.test("initWebsocket #1", async () => {
  await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
  let counter = 0;
  let timer = 0;
  ec.ws.onopen = (event) => {
    log.debug("OPEN websocket: ", { event });
  };
  ec.ws.onclose = (event) => {
    log.debug("CLOSE websocket: ", { event });
  };
  ec.ws.onerror = (event) => {
    log.debug("ERROR websocket: ", { event });
    clearInterval(timer);
  };
  ec.ws.onmessage = (mes) => {
    log.debug("Receive message: ", { mes });
    assertEquals(JSON.parse(mes.data).ret_msg, "pong");
    counter++;

    if (counter === 5) {
      clearInterval(timer);
      ec.ws.close();
    }
  };
  // ping.
  const pingMes = JSON.stringify({ op: "ping" });
  ec.ws.send(pingMes);

  timer = ec.wsHeartbeat(pingMes, 100);

  // Wait until CLOSE.
  while (true) {
    log.debug("readyState:", ec.ws.readyState);
    if (ec.ws.readyState === WebSocket.CLOSED) {
      break;
    }
    await delay(100);
  }
});

Deno.test("logBalance #1", async () => {
  await ec.logBalance("BTC");
});
