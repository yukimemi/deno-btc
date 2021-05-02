import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
// import * as talib from "https://esm.sh/talib.js";
import { delay } from "https://deno.land/std/async/mod.ts";

export type Trend = "Bullish" | "Bearlish" | "None";

export class Exchange {
  BTC = "BTC/USD";
  XRP = "XRP/USD";

  // ta = talib;

  public ec!: ccxt.Exchange;
  public trend!: Trend;
  public ohlcv!: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    value: number[];
  };

  constructor(apiKey: string, secret: string) {}

  async loadMarkets(reload?: boolean): Promise<ccxt.Dictionary<ccxt.Market>> {
    return await this.ec.loadMarkets(reload);
  }

  async fetchTicker(
    symbol: string,
    params?: ccxt.Params
  ): Promise<ccxt.Ticker> {
    if (this.ec.hasFetchTicker) {
      return await this.ec.fetchTicker(symbol, params);
    }

    return await this._fetchTicker(symbol, params);
  }

  async _fetchTicker(
    symbol: string,
    params?: ccxt.Params
  ): Promise<ccxt.Ticker> {
    return await Promise.reject("No default implementation.");
  }

  async logBalance(symbol: string): Promise<void> {
    const balance = await this.ec.fetchBalance();
    console.log({ [symbol]: balance[symbol] });
  }

  logBalanceInterval(symbol: string, interval: number): void {
    setInterval(async () => {
      await this.logBalance(symbol);
    }, interval);
  }

  async fetchTickers(
    symbol?: string[],
    params?: ccxt.Params
  ): Promise<ccxt.Dictionary<ccxt.Ticker>> {
    if (this.ec.hasFetchTickers) {
      return await this.ec.fetchTickers(symbol, params);
    }

    return await this._fetchTickers(symbol, params);
  }

  async _fetchTickers(
    symbol?: string[],
    params?: ccxt.Params
  ): Promise<ccxt.Dictionary<ccxt.Ticker>> {
    return await Promise.reject("No default implementation.");
  }

  async fetchPrices(
    symbol: string
  ): Promise<{ bid: number; ask: number; spread: number }> {
    const orderbook = await this.ec.fetchOrderBook(symbol);
    const bid = orderbook.bids[0][0];
    const ask = orderbook.asks[0][0];
    const spread = ask - bid;
    log.debug(this.ec.id, "market price", { bid, ask, spread });
    return { bid, ask, spread };
  }

  async fetchOHLCV(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    params?: ccxt.Params
  ): Promise<ccxt.OHLCV[]> {
    if (this.ec.hasFetchOHLCV) {
      const ohlcv = await this.ec.fetchOHLCV(
        symbol,
        timeframe,
        since,
        limit,
        params
      );

      this.ohlcv = {
        open: ohlcv.map((x) => x[1]),
        high: ohlcv.map((x) => x[2]),
        low: ohlcv.map((x) => x[3]),
        close: ohlcv.map((x) => x[4]),
        value: ohlcv.map((x) => x[5]),
      };

      return ohlcv;
    }

    return await this._fetchOHLCV(symbol, timeframe, since, limit, params);
  }

  async _fetchOHLCV(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
    params?: ccxt.Params
  ): Promise<ccxt.OHLCV[]> {
    return await Promise.reject("No default implementation.");
  }
}
