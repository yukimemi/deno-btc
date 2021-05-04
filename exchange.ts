import _ from "https://cdn.skypack.dev/lodash";
import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
import { hmac } from "https://deno.land/x/crypto/hmac.ts";
import { encodeToString } from "https://deno.land/x/std/encoding/hex.ts";

export type Trend = "Bullish" | "Bearlish" | "None";

export class Exchange {
  public ec!: ccxt.Exchange;
  public ws!: WebSocket;
  // deno-lint-ignore no-explicit-any
  public onOpens: ((ev: Event) => any)[] = [];
  // deno-lint-ignore no-explicit-any
  public onCloses: ((ev: Event) => any)[] = [];
  // deno-lint-ignore no-explicit-any
  public onErrors: ((ev: Event | ErrorEvent) => any)[] = [];
  // deno-lint-ignore no-explicit-any
  public onMessages: ((data: any) => any)[] = [];
  public trend!: Trend;
  public ohlcv: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    value: number[];
  } = { open: [], high: [], low: [], close: [], value: [] };
  public orders: ccxt.Order[] = [];

  constructor(_apiKey: string, _secret: string) {}

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

    this.ws.onopen = (ev) => {
      this.onOpens.forEach((f) => f(ev));
    };
    this.ws.onclose = (ev) => {
      this.onCloses.forEach((f) => f(ev));
    };
    this.ws.onerror = (ev) => {
      this.onErrors.forEach((f) => f(ev));
    };
    this.ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      this.onMessages.forEach((f) => f(data));
    };

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

  /*
    {
      balance: {
        info: {
          ret_code: "0",
          ret_msg: "OK",
          ext_code: "",
          ext_info: "",
          result: { BTC: [Object], EOS: [Object], ETH: [Object], USDT: [Object], XRP: [Object] },
          time_now: "1620143829.975813",
          rate_limit_status: "119",
          rate_limit_reset_ms: "1620143829972",
          rate_limit: 120
        },
        BTC: { free: 0.17150869, used: 0.00000286, total: 0.17150967 },
        EOS: { free: 0, used: 0, total: 0 },
        ETH: { free: 0, used: 0, total: 0 },
        USDT: { free: 0, used: 0, total: 0 },
        XRP: { free: 0, used: 0, total: 0 },
        free: { BTC: 0.17150869, EOS: 0, ETH: 0, USDT: 0, XRP: 0 },
        used: { BTC: 0.00000286, EOS: 0, ETH: 0, USDT: 0, XRP: 0 },
        total: { BTC: 0.17150967, EOS: 0, ETH: 0, USDT: 0, XRP: 0 }
      }
    }
  */
  async fetchBalance(params?: ccxt.Params): Promise<ccxt.Balances> {
    return await this.ec.fetchBalance(params);
  }

  /*
    {
      ticker: {
        symbol: "BTC/USD",
        timestamp: 1620144233699,
        datetime: "2021-05-04T16:03:53.699Z",
        high: 58180,
        low: 53595,
        bid: 53914.5,
        bidVolume: undefined,
        ask: 53915,
        askVolume: undefined,
        vwap: 56196.92602369015,
        open: 57750.5,
        close: 53914.5,
        last: 53914.5,
        previousClose: undefined,
        change: -3836,
        percentage: -6.6423,
        average: 55832.5,
        baseVolume: 30197.37,
        quoteVolume: 1696999368,
        info: {
          symbol: "BTCUSD",
          bid_price: "53914.5",
          ask_price: "53915",
          last_price: "53914.50",
          last_tick_direction: "PlusTick",
          prev_price_24h: "57750.50",
          price_24h_pcnt: "-0.066423",
          high_price_24h: "58180.00",
          low_price_24h: "53595.00",
          prev_price_1h: "54890.50",
          price_1h_pcnt: "-0.01778",
          mark_price: "53928.19",
          index_price: "53918.68",
          open_interest: "83738252",
          open_value: "14123.32",
          total_turnover: "10377633.96",
          turnover_24h: "30197.37",
          total_volume: "179528541632",
          volume_24h: "1696999368",
          funding_rate: "0.0001",
          predicted_funding_rate: "0.0001",
          next_funding_time: "2021-05-05T00:00:00Z",
          countdown_hour: "8",
          delivery_fee_rate: "0",
          predicted_delivery_price: "0.00",
          delivery_time: ""
        }
      }
    }
  */
  async fetchTicker(
    symbol: string,
    params?: ccxt.Params
  ): Promise<ccxt.Ticker> {
    return await this.ec.fetchTicker(symbol, params);
  }

  async logBalance(symbol: string): Promise<void> {
    const balance = await this.fetchBalance();
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

  async createOrder(
    symbol: string,
    type: string,
    side: "buy" | "sell",
    amount: number,
    price?: number,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    const order = await this.ec.createOrder(
      symbol,
      type,
      side,
      amount,
      price,
      params
    );
    this.orders.push(order);
    return order;
  }

  async createLimitOrder(
    symbol: string,
    side: "buy" | "sell",
    amount: number,
    price: number,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    const order = await this.ec.createLimitOrder(
      symbol,
      side,
      amount,
      price,
      params
    );
    this.orders.push(order);
    return order;
  }

  async createLimitBuyOrder(
    symbol: string,
    amount: number,
    price: number,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    const order = await this.ec.createLimitBuyOrder(
      symbol,
      amount,
      price,
      params
    );
    this.orders.push(order);
    return order;
  }

  async createLimitSellOrder(
    symbol: string,
    amount: number,
    price: number,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    const order = await this.ec.createLimitSellOrder(
      symbol,
      amount,
      price,
      params
    );
    this.orders.push(order);
    return order;
  }

  async cancelOrder(
    id: string,
    symbol?: string,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    this.ec.cancelOrders();
    const order = await this.ec.cancelOrder(id, symbol, params);
    _.remove(this.orders, (x: ccxt.Order) => x.id);
    return order;
  }

  async cancelAllOrders(
    symbol: string,
    params?: ccxt.Params
  ): Promise<ccxt.Order> {
    const orders = await this.ec.cancelAllOrders(symbol, params);
    this.orders = [];
    return orders;
  }
}
