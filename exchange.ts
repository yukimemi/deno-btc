import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
// import * as talib from "https://esm.sh/talib.js";
import { delay } from "https://deno.land/std/async/mod.ts";
import { hmac, SupportedAlgorithm } from "https://deno.land/x/crypto/hmac.ts";
import { encodeToString } from "https://deno.land/x/std/encoding/hex.ts";

export type Trend = "Bullish" | "Bearlish" | "None";
export const SYMBOL = {
  BTCUSD: "BTC/USD",
  XRPUSD: "XRP/USD",
} as const;

export class Exchange {
  // ta = talib;

  public ec!: ccxt.Exchange;
  public ws!: WebSocket;
  public trend!: Trend;
  public ohlcv!: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    value: number[];
  };

  constructor(apiKey: string, secret: string) {}

  async initWebsocket(
    url: string,
    apiKey: string,
    secret: string
  ): Promise<void> {
    const expires = Date.now() + 1000;
    const te = new TextEncoder();
    const key = te.encode(secret);
    const data = te.encode(`GET/realtime${expires}`);
    const signature = encodeToString(hmac("sha256", key, data));

    const params = `api_key=${apiKey}&expires=${expires}&signature=${signature}`;
    const wsUrl = `${url}?${params}`;
    console.log(`connect: [${wsUrl}]`);
    this.ws = new WebSocket(wsUrl);

    // Wait until OPEN.
    while (true) {
      log.debug("[initWebsocket] readyState:", this.ws.readyState);
      if (this.ws.readyState === WebSocket.OPEN) {
        break;
      }
      await delay(100);
    }
  }

  startHeartBeat(message: string, interval: number): number {
    return setInterval(() => {
      log.debug("[startHeartBeat] readyState:", this.ws.readyState);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(message);
      }
    }, interval);
  }

  async loadMarkets(reload?: boolean): Promise<ccxt.Dictionary<ccxt.Market>> {
    return await this.ec.loadMarkets(reload);
  }

  async fetchTicker(
    symbol: string,
    params?: ccxt.Params
  ): Promise<ccxt.Ticker> {
    return await this.ec.fetchTicker(symbol, params);
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
    return await this.ec.fetchTickers(symbol, params);
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
}
