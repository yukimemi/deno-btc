import * as log from "https://deno.land/std/log/mod.ts";
import { Lock } from "https://deno.land/x/async@v1.1/mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 60_000;
const CANCEL_INTERVAL = 10_000;
const CLOSE_POSITION_INTERVAL = 10_000;
const LEVERAGE = 20;
const CLOSE_DELTA_PRICE = 50;
const LOT = 0.01;
const TAKE_PROFIT = 200;
const TAKE_PROFIT_CLOSE = 100;
const STOP_LOSS = 500;
const SPREAD_THRESHOLD_MIN = 10;
const SPREAD_THRESHOLD_MAX = 50;
const CANCEL_ORDER_DIFF = 2_000;
const ORDER_DELTA_PRICE = 0.5;
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
    let orderStop = false;
    ec.onMessages.push(async (message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        await lock.with(async () => {
          const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
          log.debug({ prices });
          const price = (prices.ask + prices.bid) / 2;
          const size = ec.balances.BTC.free * price;
          const lot = Math.round(size * LOT * LEVERAGE);
          ec.positionSizeMax = lot * ORDER_LENGTH_MAX;
          if (
            (prices.ask === beforePrices.ask &&
              prices.bid === beforePrices.bid &&
              prices.spread === beforePrices.spread) ||
            prices.spread < SPREAD_THRESHOLD_MIN ||
            orderStop
          ) {
            return;
          }
          if (prices.spread > SPREAD_THRESHOLD_MAX) {
            beforePrices = prices;
            orderStop = true;
            console.log("Wait 30 s", { prices });
            setTimeout(() => {
              orderStop = false;
            }, 30_000);
            return;
          }
          if (
            Math.abs(prices.ask - beforePrices.ask) >
            Math.abs(prices.bid - beforePrices.bid)
          ) {
            console.log("Bullish", { prices });
            if (!ec.canCreateOrder("Buy")) {
              return;
            }
            const price = Math.round(prices.ask - ORDER_DELTA_PRICE);
            console.log("Buy:", { lot, price: price });
            await ec.createLimitBuyOrder(BTCUSD, lot, price, {
              time_in_force: "PostOnly",
            });
          } else {
            console.log("Bearrish", { prices });
            if (!ec.canCreateOrder("Sell")) {
              return;
            }
            const price = Math.round(prices.bid + ORDER_DELTA_PRICE);
            console.log("Sell:", { lot, price: price });
            await ec.createLimitSellOrder(BTCUSD, lot, price, {
              time_in_force: "PostOnly",
            });
          }
          beforePrices = prices;
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
