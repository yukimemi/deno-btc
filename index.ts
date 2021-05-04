import { postSlack } from "./mod.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const BTCUSD = "BTC/USD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 10_000;
const LEVERAGE = 1.5;
const DELTA_PRICE = 5;
const LOT = 0.01;
const TAKE_PROFIT = 200;
const STOP_LOSS = 100;
const SPREAD_THRESHOLD = 10;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;
const wsUrl = Deno.env.get("BYBIT_WS_URL") ?? "";
const wsApiKey = Deno.env.get("BYBIT_WS_API_KEY") ?? "";
const wsSecret = Deno.env.get("BYBIT_WS_API_SECRET") ?? "";

const main = async () => {
  const ec = new Bybit(apiKey, secret, testnet);
  const logBalanceTimer = ec.logBalanceInterval("BTC", FETCH_BALANCE_INTERVAL);

  let timer = 0;
  try {
    await delay(5_000);

    const ticker = await ec.fetchTicker(BTCUSD);
    const price = (ticker.ask + ticker.bid) / 2;
    const size = (await ec.fetchBalance()).BTC.free * price;
    const lot = Math.round(size * LOT);
    console.log({ price, size, lot });
    let beforePrices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
    ec.onOpens.push((ev) => console.log("OPEN:", { ev }));
    ec.onCloses.push((ev) => console.log("CLOSE:", { ev }));
    ec.onErrors.push((ev) => {
      console.error({ ev });
      throw `Error message: ${(ev as ErrorEvent).message}`;
    });

    const id = ec.ec.market(BTCUSD).id;
    ec.onMessages.push(async (message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        const prices = ec.getBestPrices(ec.orderBookL2[BTCUSD]);
        console.log({ prices });
        if (prices.spread > SPREAD_THRESHOLD) {
          if (
            Math.abs(prices.ask - beforePrices.ask) >
            Math.abs(prices.bid - beforePrices.bid)
          ) {
            console.log("Buy:", { lot, price: prices.bid });
            await ec.createLimitBuyOrder(BTCUSD, lot, prices.bid, {
              time_in_force: "PostOnly",
            });
          } else {
            console.log("Sell:", { lot, price: prices.ask });
            await ec.createLimitSellOrder(BTCUSD, lot, prices.ask, {
              time_in_force: "PostOnly",
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
    if (ec.ws.readyState !== WebSocket.CLOSED) {
      ec.ws.close();
    }
    console.log("catch");
    await delay(30_000);
    await main();
  }
};

await main();
