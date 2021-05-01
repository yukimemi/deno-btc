import ccxt from "https://esm.sh/ccxt";
import { assert, assertEquals } from "https://deno.land/std/testing/asserts.ts";
import {
  postSlack,
  logBalance,
  getBtcBalance,
  getEquity,
  getUsd,
  getBtcSize,
  getOrderBtcSize,
  getIndexPrice,
  getCandle,
  getProfit,
  getBestBid,
  getBestAsk,
  getTrend,
  getPosition,
  getPredictedFundingRate,
} from "./mod.ts";

const SYMBOL = "BTCUSD";
const CHANNEL = "#bybit-test";
const PER_PAGE = 199;

const ccxtApiKey = Deno.env.get("CCXT_API_KEY");
const ccxtApiSecret = Deno.env.get("CCXT_API_SECRET");
const testnet = Deno.env.get("TESTNET") ?? false;

const exc = new ccxt.bybit({
  apiKey: ccxtApiKey,
  secret: ccxtApiSecret,
  enableRateLimit: true,
});

if (testnet) {
  exc.urls.api = exc.urls.test;
}

Deno.test("logBalance", async () => {
  const btc = await logBalance(exc);
  assert(typeof btc.free === "number");
  assert(typeof btc.used === "number");
  assert(typeof btc.total === "number");
});

Deno.test("getBtcBalance", async () => {
  const btc = await getBtcBalance(exc);
  console.log({ btc });
  assert(typeof btc === "number");
});

Deno.test("getEquity", async () => {
  const equity = await getEquity(exc);
  console.log({ equity });
  assert(typeof equity === "number");
});

Deno.test("getIndexPrice", async () => {
  const indexPrice = await getIndexPrice(exc);
  console.log({ indexPrice });
  assert(typeof indexPrice === "number");
});

Deno.test("getUsd", async () => {
  const usd = await getUsd(exc);
  console.log({ usd });
  assert(typeof usd === "number");
});

Deno.test("getBtcSize", async () => {
  const size = await getBtcSize(exc);
  console.log({ size });
  assert(typeof size === "number");
});

Deno.test("getOrderBtcSize", async () => {
  const size = await getOrderBtcSize(exc, 1.5);
  console.log({ size });
  assert(typeof size === "number");
});

Deno.test("getPosition", async () => {
  const pos = await getPosition(exc);
  console.log({ pos });
});

Deno.test("getProfitBuy", () => {
  const profit = getProfit("Buy", 5900, 5000);
  console.log({ profit });
  assertEquals(profit, 900);
});

Deno.test("getProfitSell", () => {
  const profit = getProfit("Sell", 5000, 5900);
  console.log({ profit });
  assertEquals(profit, 900);
});

Deno.test("getPredictedFundingRate", async () => {
  const fund = await getPredictedFundingRate(exc, SYMBOL);
  console.log({ fund });
  assert(typeof fund.preRate === "number");
  assert(typeof fund.preFee === "number");
});

Deno.test("getCandle15Max", async () => {
  const interval = 15;
  const from =
    Math.floor(new Date().getTime() / 1000) - interval * 60 * PER_PAGE;
  const candle = await getCandle({ exc, interval: interval.toString(), from });
  console.log({ candle });
  assertEquals(candle.open.length, PER_PAGE);
  assertEquals(candle.close.length, PER_PAGE);
  assertEquals(candle.high.length, PER_PAGE);
  assertEquals(candle.low.length, PER_PAGE);
});
Deno.test("getCandle5_10", async () => {
  const interval = 5;
  const perPage = 10;
  const from =
    Math.floor(new Date().getTime() / 1000) - interval * 60 * perPage;
  const candle = await getCandle({ exc, interval: interval.toString(), from });
  console.log({ candle });
  assertEquals(candle.open.length, perPage);
  assertEquals(candle.close.length, perPage);
  assertEquals(candle.high.length, perPage);
  assertEquals(candle.low.length, perPage);
});
Deno.test("getCandle30_5", async () => {
  const interval = 30;
  const perPage = 5;
  const from =
    Math.floor(new Date().getTime() / 1000) - interval * 60 * perPage;
  const candle = await getCandle({ exc, interval: interval.toString(), from });
  console.log({ candle });
  assertEquals(candle.open.length, perPage);
  assertEquals(candle.close.length, perPage);
  assertEquals(candle.high.length, perPage);
  assertEquals(candle.low.length, perPage);
});

Deno.test("getBestBid", async () => {
  const p = await getBestBid(exc);
  console.log({ p });
  assert(typeof p === "number");
});
Deno.test("getBestAsk", async () => {
  const p = await getBestAsk(exc);
  console.log({ p });
  assert(typeof p === "number");
});

Deno.test("getTrend", async () => {
  const interval = 15;
  const from =
    Math.floor(new Date().getTime() / 1000) - interval * 60 * PER_PAGE;
  const candle = await getCandle({ exc, interval: interval.toString(), from });
  const trend = getTrend(candle);
  console.log({ trend });
});

Deno.test("postSlack", async () => {
  const chan = CHANNEL;
  const msg = "test message";
  const result = await postSlack(chan, msg);
  console.log({ result });
});
