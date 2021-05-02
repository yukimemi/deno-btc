import { assert, assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { Exchange } from "./exchange.ts";
import { Bybit } from "./bybit.ts";

const PER_PAGE = 199;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;

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

Deno.test("logBalance #1", async () => {
  await ec.logBalance("BTC");
});
