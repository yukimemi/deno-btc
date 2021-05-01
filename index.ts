import ccxt from "https://esm.sh/ccxt";
import {
  createOrder,
  getCandle,
  getIndexPrice,
  getPosition,
  getTrend,
  logBalanceInterval,
  postSlack,
  setTralingStop,
  getOrderBtcSize,
} from "./mod.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const SYMBOL = "BTCUSD";
const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 10_000;
const DELAY_INTERVAL = 10_000;
const LEVERAGE = 1.5;
const TRAILING_STOP = 50;
const TAKE_PROFIT = TRAILING_STOP * 2.0;
const STOP_LOSS = TRAILING_STOP * 4;
const INTERVAL = 1;
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

logBalanceInterval(exc, FETCH_BALANCE_INTERVAL);

const main = async (exc: ccxt.Exchange) => {
  try {
    const pos = await getPosition(exc);
    if (pos.side !== "None") {
      const idxPrice = await getIndexPrice(exc);
      const stop_loss =
        pos.side === "Buy"
          ? Math.round(Number(pos.entry_price) - STOP_LOSS)
          : Math.round(Number(pos.entry_price) + STOP_LOSS);
      const profit =
        pos.side === "Buy"
          ? idxPrice - Number(pos.entry_price)
          : Number(pos.entry_price) - idxPrice;
      if (profit > TAKE_PROFIT) {
        const res = await setTralingStop({
          exc,
          pos,
          stop_loss: stop_loss.toString(),
          trailing_stop: TRAILING_STOP.toString(),
        });
        // console.log({ res });
      } else {
        const res = await setTralingStop({
          exc,
          pos,
          stop_loss: stop_loss.toString(),
          trailing_stop: pos.trailing_stop,
        });
        // console.log({ res });
      }
      return;
    }

    const from =
      Math.floor(new Date().getTime() / 1000) - INTERVAL * 60 * PER_PAGE;
    const candle = await getCandle({
      exc,
      interval: INTERVAL.toString(),
      from,
    });
    const trend = getTrend(candle);

    if (trend === "Bullish") {
      console.log(`trend: Bullish !`);
      const price = await getIndexPrice(exc);
      const size = await getOrderBtcSize(exc, LEVERAGE);
      const res = await createOrder(exc, {
        symbol: SYMBOL,
        side: "Buy",
        order_type: "Limit",
        qty: size,
        price,
        time_in_force: "ImmediateOrCancel",
      });
    }

    if (trend === "Bearlish") {
      console.log(`trend: Bearlish !`);
      const price = await getIndexPrice(exc);
      const size = await getOrderBtcSize(exc, LEVERAGE);
      const res = await createOrder(exc, {
        symbol: SYMBOL,
        side: "Sell",
        order_type: "Limit",
        qty: size,
        price,
        time_in_force: "ImmediateOrCancel",
      });
    }
  } catch (e) {
    console.error(e);
  } finally {
    await delay(DELAY_INTERVAL);
    await main(exc);
  }
};

await main(exc);
