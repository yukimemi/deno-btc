import * as log from "https://deno.land/std/log/mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
import { postSlack } from "./mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 60_000;
const CANCEL_INTERVAL = 10_000;
const CLOSE_POSITION_INTERVAL = 10_000;
const LEVERAGE = 100;
const DELTA_PRICE = 5;
const LOT = 0.01;
const TAKE_PROFIT = 200;
const STOP_LOSS = 100;
const SPREAD_THRESHOLD = 10;
const CANCEL_ORDER_DIFF = 1000 * 5;

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
    DELTA_PRICE
  );

  let timer = 0;
  let lot = 0;
  try {
    await delay(5_000);

    await ec.fetchBalance();
    let beforePrices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
    ec.onOpens.push((ev) => console.log("OPEN:", { ev }));
    ec.onCloses.push((ev) => console.log("CLOSE:", { ev }));
    ec.onErrors.push((ev) => {
      console.error({ ev });
      throw `Error message: ${(ev as ErrorEvent).message}`;
    });

    await ec.loadMarkets();
    const id = ec.ec.market(BTCUSD).id;
    ec.onMessages.push(async (message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
        log.debug({ prices });
        if (
          prices.spread > SPREAD_THRESHOLD &&
          !(
            prices.ask === beforePrices.ask &&
            prices.bid === beforePrices.bid &&
            prices.spread === beforePrices.spread
          )
        ) {
          console.log({ prices });
          const price = (prices.ask + prices.bid) / 2;
          const size = ec.balances.BTC.free * price;
          lot = Math.round(size * LOT * LEVERAGE);
          if (
            Math.abs(prices.ask - beforePrices.ask) >
            Math.abs(prices.bid - beforePrices.bid)
          ) {
            beforePrices = prices;
            // deno-lint-ignore camelcase
            const take_profit = Math.round(prices.bid + TAKE_PROFIT);
            // deno-lint-ignore camelcase
            const stop_loss = Math.round(prices.bid - STOP_LOSS);
            console.log("Buy:", { lot, price: prices.bid });
            await ec.createLimitBuyOrder(BTCUSD, lot, prices.bid, {
              time_in_force: "PostOnly",
              take_profit,
              stop_loss,
            });
          } else {
            beforePrices = prices;
            // deno-lint-ignore camelcase
            const take_profit = Math.round(prices.ask - TAKE_PROFIT);
            // deno-lint-ignore camelcase
            const stop_loss = Math.round(prices.ask + STOP_LOSS);
            console.log("Sell:", { lot, price: prices.ask });
            await ec.createLimitSellOrder(BTCUSD, lot, prices.ask, {
              time_in_force: "PostOnly",
              take_profit,
              stop_loss,
            });
          }
        }
        beforePrices = prices;
      }
    });

    await ec.initWebsocket(wsUrl, wsApiKey, wsSecret);
    timer = ec.startHeartBeat(JSON.stringify({ op: "ping" }), 30_000);
    await ec.subscribeOrderBookL2_25(BTCUSD);
    await ec.subscribePosition(BTCUSD, TAKE_PROFIT, STOP_LOSS, DELTA_PRICE);
  } catch (e) {
    console.error({ e });
    clearInterval(timer);
    clearInterval(logBalanceTimer);
    clearInterval(cancelTimer);
    clearInterval(closePositionTimer);
    if (ec.ws.readyState !== WebSocket.CLOSED) {
      ec.ws.close();
    }
    console.log("catch");
    await delay(30_000);
    await main();
  }
};

await main();
