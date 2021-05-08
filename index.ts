import * as log from "https://deno.land/std/log/mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
import { postSlack } from "./mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 60_000;
const CANCEL_INTERVAL = 10_000;
const CLOSE_POSITION_INTERVAL = 10_000;
const LEVERAGE = 10;
const CLOSE_DELTA_PRICE = -5;
const LOT = 0.01;
const TAKE_PROFIT = 200;
const TAKE_PROFIT_CLOSE = 100;
const STOP_LOSS = 200;
const SPREAD_THRESHOLD = 0.5;
const CANCEL_ORDER_DIFF = 2_000;
const ORDER_DELTA_PRICE = 0.5;
const ORDER_LENGTH_MAX = 3;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";

const main = async () => {
  const ec = new Bybit(apiKey, secret, testnet);
  const logBalanceTimer = ec.logBalanceInterval(
    "BTC",
    FETCH_BALANCE_INTERVAL,
    CHANNEL
  );
  const cancelTimer = ec.cancelOrderInterval(
    BTCUSD,
    CANCEL_INTERVAL,
    CANCEL_ORDER_DIFF
  );
  const closePositionTimer = ec.closePositionInterval(
    BTCUSD,
    CLOSE_POSITION_INTERVAL,
    CLOSE_DELTA_PRICE,
    TAKE_PROFIT_CLOSE
  );

  let timer = 0;
  try {
    await delay(5_000);

    await ec.cancelAllOrders(BTCUSD);
    await ec.fetchBalance();
    ec.onOpens.push((ev) => console.log("OPEN:", { ev }));
    ec.onCloses.push((ev) => console.log("CLOSE:", { ev }));
    ec.onErrors.push((ev) => {
      console.error({ ev });
      throw `Error message: ${(ev as ErrorEvent).message}`;
    });

    await ec.loadMarkets();
    const id = ec.ec.market(BTCUSD).id;
    let orderLength = 0;
    setInterval(() => {
      const beforeLength = orderLength;
      orderLength = ec.openOrders.length;
      console.log("Update:", { beforeLength, orderLength });
    }, 5_000);
    ec.onMessages.push(async (message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
        log.debug({ prices });
        const price = (prices.ask + prices.bid) / 2;
        const size = ec.balances.BTC.free * price;
        const lot = Math.round(size * LOT * LEVERAGE);
        ec.positionSizeMax = lot * ORDER_LENGTH_MAX;
        if (
          prices.spread > SPREAD_THRESHOLD ||
          orderLength > ORDER_LENGTH_MAX
        ) {
          return;
        }
        if (ec.canCreateOrder("Buy")) {
          orderLength++;
          const price = Math.round(prices.ask - ORDER_DELTA_PRICE);
          console.log("Buy:", { lot, price: price });
          await ec.createLimitBuyOrder(BTCUSD, lot, price, {
            time_in_force: "PostOnly",
          });
        }
        if (ec.canCreateOrder("Sell")) {
          orderLength++;
          const price = Math.round(prices.bid + ORDER_DELTA_PRICE);
          console.log("Sell:", { lot, price: price });
          await ec.createLimitSellOrder(BTCUSD, lot, price, {
            time_in_force: "PostOnly",
          });
        }
      }
    });

    await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
    timer = ec.startHeartBeat(JSON.stringify({ op: "ping" }), 30_000);
    await ec.subscribeOrderBookL2_25(BTCUSD);
    await ec.subscribePosition(
      BTCUSD,
      TAKE_PROFIT,
      STOP_LOSS,
      CLOSE_DELTA_PRICE
    );
  } catch (e) {
    console.error({ e });
    clearInterval(timer);
    clearInterval(logBalanceTimer);
    clearInterval(cancelTimer);
    clearInterval(closePositionTimer);
    if (ec.ws.readyState !== WebSocket.CLOSED) {
      ec.ws.close();
    }
  }
};

await main();
