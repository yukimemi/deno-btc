import _ from "https://cdn.skypack.dev/lodash";
import * as log from "https://deno.land/std/log/mod.ts";
import { Bybit } from "./bybit.ts";
import { assert, assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";

const BTCUSD = "BTC/USD";
const XRPUSD = "XRP/USD";
const RETRY_CNT = 5;
let retry = 0;

const ec = new Bybit(apiKey, secret, testnet, 10);

Deno.test("loadMarkets #1", async () => {
  const markets = await ec.loadMarkets();
  log.debug({ markets });
  log.debug({ ec });
});

Deno.test("fetchBalance #1", async () => {
  const balance = await ec.fetchBalance();
  log.debug({ balance });
});

Deno.test("fetchTicker #1", async () => {
  const ticker = await ec.fetchTicker(BTCUSD);
  log.debug({ ticker });
  assert(ticker.ask > 50000);
  assert(ticker.bid > 50000);
});

Deno.test("fetchTicker #2", async () => {
  const ticker = await ec.fetchTicker(XRPUSD);
  assert(ticker.ask > 1);
  assert(ticker.bid > 1);
});

Deno.test("fetchTickers #1", async () => {
  const tickers = await ec.fetchTickers([BTCUSD, XRPUSD]);
  assert(tickers[BTCUSD].ask > 50000);
  assert(tickers[BTCUSD].bid > 50000);
  assert(tickers[XRPUSD].ask > 1);
  assert(tickers[XRPUSD].bid > 1);
});

Deno.test("fetchOrders #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const _buyOrder = await ec.createLimitBuyOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  const _sellOrder = await ec.createLimitSellOrder(BTCUSD, 1, prices.ask, {
    time_in_force: "PostOnly",
  });
  const orders = await ec.fetchOrders(BTCUSD);
  assert(orders.length >= 2);
});

Deno.test("fetchOpenOrders #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const _buyOrder = await ec.createLimitBuyOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  const _sellOrder = await ec.createLimitSellOrder(BTCUSD, 1, prices.ask, {
    time_in_force: "PostOnly",
  });
  const orders = await ec.fetchOpenOrders(BTCUSD);
  assert(orders.length >= 2);
});

Deno.test("fetchPositions #1", async () => {
  await ec.createOrder(BTCUSD, "market", "buy", 1);
  await delay(5000);
  const positions = await ec.fetchPositions([BTCUSD], {
    type: "inverse",
  });
});

Deno.test("fetchOHLCV #1", async () => {
  const times = 30;
  const since = ec.ec.milliseconds() - 1000 * 60 * times;
  const timeframe = "1m";
  const ohlcv = await ec.fetchOHLCV(BTCUSD, timeframe, since);
  assertEquals(ohlcv.length, times);
});

Deno.test("fetchOHLCV #2", async () => {
  const times = 60;
  const since = ec.ec.milliseconds() - 1000 * 60 * 60 * times;
  const timeframe = "1h";
  const ohlcv = await ec.fetchOHLCV(BTCUSD, timeframe, since);
  assertEquals(ohlcv.length, times);
});

Deno.test("fetchPrices #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  log.debug({ prices });
  assert(prices.ask > 50000);
  assert(prices.bid > 50000);
  assert(prices.spread < 50);
});

Deno.test({
  name: "websocket #1",
  fn: async () => {
    let timer = 0;
    let pingCnt = 0;
    let orderBookL2Cnt = 0;

    ec.onOpens.push((event) => {
      log.debug("OPEN websocket: ", { event });
    });
    ec.onCloses.push((event) => {
      log.debug("CLOSE websocket: ", { event });
      clearInterval(timer);
    });
    ec.onErrors.push(async (event) => {
      log.error("ERROR websocket: ", (event as ErrorEvent).message);
      clearInterval(timer);
      retry++;
      if (retry > RETRY_CNT) {
        throw `(retry > RETRY_CNT) = (${retry} > ${RETRY_CNT})`;
      }
      await delay(5000);
      await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
    });
    ec.onMessages.push((mes) => {
      log.debug({ mes });

      if (mes.topic === "orderBookL2_25.BTCUSD") {
        orderBookL2Cnt++;

        if (orderBookL2Cnt === 5) {
          close.orderBookL2_25_BTCUSD = true;
        }
      } else if (mes.ret_msg === "pong") {
        pingCnt++;
        if (pingCnt === 5) {
          close.ping = true;
        }
      }

      if (Object.values(close).every((x) => x)) {
        ec.ws.close();
      }
    });

    await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
    // ping.
    const pingMes = JSON.stringify({ op: "ping" });
    ec.ws.send(pingMes);

    const close = {
      ping: false,
      // deno-lint-ignore camelcase
      orderBookL2_25_BTCUSD: false,
    };
    timer = ec.startHeartBeat(pingMes, 100);
    await ec.subscribeOrderBookL2_25(BTCUSD);

    // Wait until CLOSE.
    while (true) {
      log.debug("readyState:", ec.ws.readyState);
      if (ec.ws.readyState === WebSocket.CLOSED) {
        break;
      }
      await delay(100);
    }
    log.debug(ec.orderBookL2);
    assert(ec.orderBookL2[BTCUSD].length > 0);
    await delay(1000);

    const bestPrices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test("logBalance #1", async () => {
  await ec.logBalance("BTC");
});

Deno.test("createLimitBuyOrder #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const order = await ec.createLimitBuyOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  log.debug({ order });
  log.debug({ orders: ec.orders });
  assert(_.includes(ec.orders, order));
});

Deno.test("createLimitSellOrder #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const order = await ec.createLimitSellOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  log.debug({ order });
  log.debug({ orders: ec.orders });
  assert(_.includes(ec.orders, order));
});

Deno.test("cancelOrder #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const buyOrder = await ec.createLimitBuyOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  if (buyOrder) {
    const cancelOrder = await ec.cancelOrder(buyOrder.id, BTCUSD);
    log.debug({ cancelOrder });
    assert(!_.includes(ec.orders, cancelOrder));
  }
});

Deno.test("cancelAllOrders #1", async () => {
  const prices = await ec.fetchPrices(BTCUSD);
  const _buyOrder = await ec.createLimitBuyOrder(BTCUSD, 1, prices.bid, {
    time_in_force: "PostOnly",
  });
  const _sellOrder = await ec.createLimitSellOrder(BTCUSD, 1, prices.ask, {
    time_in_force: "PostOnly",
  });
  const cancelOrders = await ec.cancelAllOrders(BTCUSD);
  assertEquals(ec.orders.length, 0);
  assertEquals(cancelOrders.length, 2);
});
