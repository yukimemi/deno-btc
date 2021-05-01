import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
import * as tech from "https://esm.sh/technicalindicators";
import StockData from "https://esm.sh/technicalindicators/declarations/StockData.d.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
import {
  WebClient,
  WebAPICallResult,
} from "https://deno.land/x/slack_web_api/mod.ts";

const SYMBOL = "BTCUSD";
const CHANNEL = "#bybit-test";

export type Trend = "Bullish" | "Bearlish" | "None";
export type Side = "Buy" | "Sell" | "None";

export type Position = {
  symbol: string;
  side: Side;
  size: number;
  entry_price: string;
  liq_price: string;
  take_profit: string;
  stop_loss: string;
  trailing_stop: string;
  position_status: string;
};

export const postSlack = async (
  channel: string,
  text: string
): Promise<WebAPICallResult> => {
  const token = Deno.env.get("SLACK_TOKEN");
  const web = new WebClient(token);

  console.log({ channel, text });

  return await web.chat.postMessage({
    channel,
    text,
  });
};

export const logBalance = async (
  exc: ccxt.Exchange
): Promise<{ free: number; used: number; total: number }> => {
  const balance = await exc.fetchBalance();
  const btc = balance.BTC;
  console.log({ btc });
  return btc;
};

export const logPredictedFund = async (exc: ccxt.Exchange) => {
  const funding = await getPredictedFundingRate(exc, SYMBOL);
  console.log({ funding });
};

export const logLastFund = async (exc: ccxt.Exchange) => {
  const funding = await getLastFundingRate(exc, SYMBOL);
  console.log({ funding });
};

export const logBalanceInterval = async (
  exc: ccxt.Exchange,
  interval: number
) => {
  await logBalance(exc);
  setTimeout(async () => {
    await logBalanceInterval(exc, interval);
  }, interval);
};

export const getIndexPrice = async (exc: ccxt.Exchange): Promise<number> => {
  const tickers = await exc.v2PublicGetTickers({ symbol: SYMBOL });
  log.debug({ tickers });
  return Number(tickers.result[0].index_price);
};

export const getBestBid = async (exc: ccxt.Exchange): Promise<number> => {
  const orderBook = await exc.v2PublicGetOrderBookL2({ symbol: SYMBOL });
  const p = orderBook.result
    .filter((x: { symbol: string }) => x.symbol === SYMBOL)
    .filter((x: { side: Side }) => x.side === "Buy")
    .map((x: { price: string }) => Number(x.price))
    .sort();
  log.debug({ p });
  return p[p.length - 1];
};

export const getBestAsk = async (exc: ccxt.Exchange): Promise<number> => {
  const orderBook = await exc.v2PublicGetOrderBookL2({ symbol: SYMBOL });
  const p = orderBook.result
    .filter((x: { symbol: string }) => x.symbol === SYMBOL)
    .filter((x: { side: Side }) => x.side === "Sell")
    .map((x: { price: string }) => Number(x.price))
    .sort();
  log.debug({ p });
  return p[0];
};

export const getWallet = async (
  exc: ccxt.Exchange,
  coin: string
): Promise<any> => {
  return await exc.v2PrivateGetWalletBalance({ coin });
};

export const getBtcBalance = async (exc: ccxt.Exchange): Promise<number> => {
  const wallet = await getWallet(exc, "BTC");
  log.debug({ wallet });
  return Number(wallet.result.BTC.wallet_balance);
};

export const getEquity = async (exc: ccxt.Exchange): Promise<number> => {
  const wallet = await getWallet(exc, "BTC");
  log.debug({ wallet });
  return Number(wallet.result.BTC.equity);
};

export const getBtcSize = async (exc: ccxt.Exchange): Promise<number> => {
  const balance = await getBtcBalance(exc);
  const indexPrice = await getIndexPrice(exc);
  return Math.round(balance * indexPrice);
};

export const getOrderBtcSize = async (
  exc: ccxt.Exchange,
  lv: number
): Promise<number> => {
  const walletSize = await getBtcSize(exc);
  return Math.round(walletSize * lv * 100) / 100;
};

export const getUsd = async (exc: ccxt.Exchange): Promise<number> => {
  const equity = await getEquity(exc);
  const indexPrice = await getIndexPrice(exc);
  return Math.round(equity * indexPrice * 100) / 100;
};

export const getPosition = async (exc: ccxt.Exchange): Promise<Position> => {
  const pos = await exc.v2PrivateGetPositionList({ symbol: SYMBOL });
  log.debug({ pos });
  return JSON.parse(pos).result;
};

export const setTralingStop = async ({
  exc,
  pos,
  take_profit,
  stop_loss,
  trailing_stop,
}: {
  exc: ccxt.Exchange;
  pos: Position;
  take_profit: number | string;
  stop_loss: number | string;
  trailing_stop: number | string;
}): Promise<any> => {
  if (
    (Number(pos.take_profit) === Number(take_profit) &&
      Number(pos.stop_loss) === Number(stop_loss) &&
      Number(pos.trailing_stop) === Number(trailing_stop)) ||
    Number(pos.trailing_stop) !== 0
  ) {
    return;
  }
  postSlack(
    CHANNEL,
    `Set trailing stop: ${JSON.stringify(
      {
        symbol: SYMBOL,
        take_profit,
        stop_loss,
        trailing_stop: Number(trailing_stop),
      },
      null,
      2
    )}`
  );
  const res = await exc.v2PrivatePostPositionTradingStop({
    symbol: SYMBOL,
    take_profit: Number(take_profit),
    stop_loss: Number(stop_loss),
    trailing_stop: Number(trailing_stop),
  });
  log.debug({ res });
  return res;
};

export const getPredictedFundingRate = async (
  exc: ccxt.Exchange,
  symbol: string
): Promise<{ preRate: number; preFee: number }> => {
  const funding = await exc.v2PrivateGetFundingPredictedFunding({ symbol });
  return {
    preRate: Number(funding.result.predicted_funding_rate),
    preFee: Number(funding.result.predicted_funding_fee),
  };
};

export const getLastFundingRate = async (
  exc: ccxt.Exchange,
  symbol: string
): Promise<{ lastRate: number; lastFee: number; lastTime: Date }> => {
  const funding = await exc.v2PrivateGetFundingPrevFunding({ symbol });
  return {
    lastRate: Number(funding.result.funding_rate),
    lastFee: Number(funding.result.exec_fee),
    lastTime: new Date(Number(funding.result.exec_timestamp) * 1000),
  };
};

export const getCandle = async ({
  exc,
  interval,
  from,
}: {
  exc: ccxt.Exchange;
  interval: string;
  from: number;
}): Promise<StockData> => {
  const kline = await exc.v2PublicGetKlineList({
    symbol: SYMBOL,
    interval,
    from,
  });
  log.debug({ kline });
  return {
    open: kline.result.map((x: Record<string, string>) => Number(x.open)),
    high: kline.result.map((x: Record<string, string>) => Number(x.high)),
    close: kline.result.map((x: Record<string, string>) => Number(x.close)),
    low: kline.result.map((x: Record<string, string>) => Number(x.low)),
  };
};

export const getTrend = (candle: StockData): Trend => {
  if (tech.bullish(candle)) {
    return "Bullish";
  } else if (tech.bearish(candle)) {
    return "Bearlish";
  } else {
    return "None";
  }
};

export const getStopLoss = (
  side: Side,
  entryPrice: number | string,
  loss: number | string
): number => {
  const stopLoss =
    side === "Buy"
      ? Math.round(Number(entryPrice) - Number(loss))
      : Math.round(Number(entryPrice) + Number(loss));
  return stopLoss;
};

export const getTakeProfit = (
  side: Side,
  entryPrice: number | string,
  profit: number | string
): number => {
  const takeProfit =
    side === "Buy"
      ? Math.round(Number(entryPrice) + Number(profit))
      : Math.round(Number(entryPrice) - Number(profit));
  return takeProfit;
};

export const getProfit = (
  side: Side,
  idxPrice: number | string,
  entryPrice: number | string
): number => {
  const profit =
    side === "Buy"
      ? Math.round(Number(idxPrice) - Number(entryPrice))
      : Math.round(Number(entryPrice) - Number(idxPrice));
  return profit;
};

export const createOrder = async (
  exc: ccxt.Exchange,
  {
    symbol,
    side,
    order_type,
    qty,
    price,
    time_in_force,
    take_profit,
    stop_loss,
  }: {
    symbol: string;
    side: string;
    order_type: string;
    qty: number;
    price?: number;
    time_in_force: string;
    take_profit: number;
    stop_loss: number;
  }
): Promise<any> => {
  await postSlack(
    CHANNEL,
    `Post order: ${JSON.stringify(
      {
        symbol,
        side,
        order_type,
        qty,
        price,
        time_in_force,
        take_profit: Math.round(take_profit),
        stop_loss: Math.round(stop_loss),
      },
      null,
      2
    )}`
  );
  let result;
  if (price === undefined) {
    result = await exc.v2PrivatePostOrderCreate({
      symbol,
      side,
      order_type,
      qty,
      time_in_force,
      take_profit,
      stop_loss,
    });
  } else {
    result = await exc.v2PrivatePostOrderCreate({
      symbol,
      side,
      order_type,
      qty,
      price: Math.round(price),
      time_in_force,
      take_profit: Math.round(take_profit),
      stop_loss: Math.round(stop_loss),
    });
  }
  delay(5000);
  return result;
};
