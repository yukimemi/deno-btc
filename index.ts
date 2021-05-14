import * as log from "https://deno.land/std/log/mod.ts";
import _ from "https://cdn.skypack.dev/lodash";
import { Lock } from "https://deno.land/x/async@v1.1/mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 60_000;
const CANCEL_INTERVAL = 30_000;
const CLOSE_POSITION_INTERVAL = 15_000;
const LEVERAGE = 10;
const CLOSE_DELTA_PRICE = 50;
const LOT = 0.01;
const TAKE_PROFIT = 200;
const TAKE_PROFIT_CLOSE = 100;
const STOP_LOSS = 500;
const SPREAD_THRESHOLD_MIN = 1.0;
const SPREAD_THRESHOLD_MAX = 5;
const CANCEL_ORDER_DIFF = 60_000;
const ORDER_DELTA_PRICE = 0.0;
const ORDER_LENGTH_MAX = 10;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";
const lock = new Lock();

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
    let beforePrices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
    let preOrderStop = false;
    let orderStop = false;
    let orderMaxStop = false;
    let orderCnt = 0;
    ec.onMessages.push(async (message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        await lock.with(() => {
          const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
          log.debug({ prices });
          const price = (prices.ask + prices.bid) / 2;
          const size = ec.balances.BTC.free * price;
          const lot = Math.round(size * LOT * LEVERAGE);
          ec.positionSizeMax = lot * ORDER_LENGTH_MAX;
          orderCnt = ec.openOrders.length;
          if (preOrderStop) {
            console.log("Next", { prices });
            preOrderStop = false;
            orderStop = true;
            console.log("Wait 3.0 s", { prices });
            setTimeout(() => {
              orderStop = false;
              orderCnt = 0;
            }, 3_000);
            return;
          }
          if (
            (prices.ask === beforePrices.ask &&
              prices.bid === beforePrices.bid &&
              prices.spread === beforePrices.spread) ||
            orderStop ||
            orderMaxStop ||
            orderCnt > ORDER_LENGTH_MAX
          ) {
            return;
          }
          if (prices.spread > SPREAD_THRESHOLD_MAX) {
            console.log("SPREAD is over max:", { prices });
            orderMaxStop = true;
            console.log("Wait 30 s", { prices });
            setTimeout(() => {
              orderMaxStop = false;
            }, 30_000);
            return;
          }
          // if (
          //   Math.abs(prices.ask - beforePrices.ask) >
          //   Math.abs(prices.bid - beforePrices.bid)
          // ) {
          console.log({ prices });
          // console.log("Bullish", { prices });
          if (ec.canCreateOrder("Buy")) {
            const price = _.round(prices.bid + ORDER_DELTA_PRICE, 1);
            [...Array(ORDER_LENGTH_MAX / ORDER_LENGTH_MAX).keys()]
              .map((x) => price - x * 0.5)
              .concat(
                [...Array(ORDER_LENGTH_MAX / ORDER_LENGTH_MAX).keys()].map(
                  (x) => price + x * 0.5
                )
              )
              .forEach((x) => {
                console.log("Buy:", { lot, price: x });
                ec.createLimitBuyOrder(BTCUSD, lot, x, {
                  time_in_force: "PostOnly",
                });
                orderCnt++;
              });
          }
          // } else {
          // console.log("Bearrish", { prices });
          if (ec.canCreateOrder("Sell")) {
            const price = _.round(prices.ask - ORDER_DELTA_PRICE, 1);
            [...Array(ORDER_LENGTH_MAX / ORDER_LENGTH_MAX).keys()]
              .map((x) => price - x * 0.5)
              .concat(
                [...Array(ORDER_LENGTH_MAX / ORDER_LENGTH_MAX).keys()].map(
                  (x) => price + x * 0.5
                )
              )
              .forEach((x) => {
                console.log("Sell:", { lot, price: x });
                ec.createLimitSellOrder(BTCUSD, lot, x, {
                  time_in_force: "PostOnly",
                });
                orderCnt++;
              });
          }
          // }
          beforePrices = prices;
          preOrderStop = true;
        });
      }
    });

    ec.onMessages.push((message) => {
      if (message.topic === "order") {
        log.debug("Receive message: ", { message });
        const order = message.data[0];
        if (order.reduce_only) {
          ec.fixedOrders.push({
            id: order.order_id,
            clientOrderId: "",
            datetime: order.timestamp,
            timestamp: 0,
            lastTradeTimestamp: 0,
            status: "open",
            symbol: BTCUSD,
            type: order.order_type,
            timeInForce: order.time_in_force,
            side: order.side === "Buy" ? "buy" : "sell",
            price: Number(order.price),
            amount: Number(order.qty),
            filled: 0,
            remaining: 0,
            cost: 0,
            trades: [],
            fee: {
              type: "taker",
              currency: "",
              rate: 0,
              cost: 0,
            },
            info: {},
          });
        } else if (ec.fixedOrders.some((x) => x.id === order.order_id)) {
          return;
        } else {
          setTimeout(async () => {
            await ec.cancelOrder(order.order_id, BTCUSD);
            orderCnt--;
          }, CANCEL_ORDER_DIFF);
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
    ec.ws.send(JSON.stringify({ op: "subscribe", args: ["order"] }));
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
