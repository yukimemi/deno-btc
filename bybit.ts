import { _, ccxt, log } from "./deps.ts";
import { Exchange } from "./exchange.ts";

export type Order = {
  id: number;
  symbol: string;
  price: string;
  side: string;
};

// OrderBookL2 structure.
/*

{
  "BTC/USD": [
    { price: "55876.50", symbol: "BTCUSD", id: 558765000, side: "Sell", size: 170702 },
    { price: "55877.00", symbol: "BTCUSD", id: 558770000, side: "Sell", size: 109304 },
    { price: "55868.50", symbol: "BTCUSD", id: 558685000, side: "Buy", size: 164652 },
    { price: "55863.50", symbol: "BTCUSD", id: 558635000, side: "Buy", size: 139459 },
    { price: "55865.50", symbol: "BTCUSD", id: 558655000, side: "Buy", size: 85723 },
    { price: "55879.00", symbol: "BTCUSD", id: 558790000, side: "Sell", size: 102895 },
    { price: "55879.50", symbol: "BTCUSD", id: 558795000, side: "Sell", size: 91631 },
  ]
}
*/
export type OrderBookL2 = {
  [key: string]: Order[];
};

export class Bybit extends Exchange {
  static timeframes = {
    "all": "1",
    "1s": "1",
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "6h": "360",
    "1d": "D",
    "1w": "W",
    "1M": "M",
  };
  public orderBookL2: OrderBookL2 = {};
  public position = {
    side: "",
    size: 0,
    entry_price: "",
    take_profit: "",
    stop_loss: "",
  };
  public positionSizeMax = 0;
  public buyStop = false;
  public sellStop = false;

  constructor(
    apiKey: string,
    secret: string,
    testnet: boolean = false,
    maxOrderCount: number,
  ) {
    super(apiKey, secret, maxOrderCount);
    this.ec = new ccxt.bybit({ apiKey, secret, enableRateLimit: true });

    if (testnet) {
      this.ec.urls.api = this.ec.urls.test;
    }
  }

  /*
    {
        id: 0,
        position_idx: 0,
        mode: 0,
        user_id: 135272,
        risk_id: 1,
        symbol: "BTCUSD",
        side: "None",
        size: 0,
        position_value: "0",
        entry_price: "0",
        is_isolated: false,
        auto_add_margin: 1,
        leverage: "100",
        effective_leverage: "100",
        position_margin: "0",
        liq_price: "0",
        bust_price: "0",
        occ_closing_fee: "0",
        occ_funding_fee: "0",
        take_profit: "0",
        stop_loss: "0",
        trailing_stop: "0",
        position_status: "Normal",
        deleverage_indicator: 0,
        oc_calc_data: '{"blq":5928,"blv":"0.10768782","slq":99,"slv":"0.00179616","bmp":55048.0082,"smp":55117.5842,"fc":-0...',
        order_margin: "0.00123922",
        wallet_balance: "0.18028934",
        realised_pnl: "-0.00072911",
        unrealised_pnl: 0,
        cum_realised_pnl: "-0.3083305",
        cross_seq: 3036038333,
        position_seq: 0,
        created_at: "2020-12-30T15:00:41.555466306Z",
        updated_at: "2021-05-05T03:28:03.546127469Z",
        tp_sl_mode: "Full"
      }
    }
  */
  async fetchPositions(symbols: string[], params?: ccxt.Params): Promise<any> {
    await this.ec.loadMarkets();
    const id = this.ec.market(symbols[0]).id;
    const res = await this.ec.v2PrivateGetPositionList({
      symbol: id,
    });
    this.position = JSON.parse(res).result;
    return this.position;
  }

  canCreateOrder(side: "Buy" | "Sell"): boolean {
    if (
      this.position.side === side &&
      Number(this.position.size) >= this.positionSizeMax
    ) {
      console.log(`Already position max. skip ${side} order:`, {
        side: this.position.side,
        size: this.position.size,
        entry_price: this.position.entry_price,
      });
      return false;
    }
    if (side === "Buy" && this.buyStop) {
      console.log("Buy stop !!!");
      return false;
    }
    if (side === "Sell" && this.sellStop) {
      console.log("Sell stop !!!");
      return false;
    }
    return true;
  }

  async v2PrivatePostOrderCreate(
    params: Record<string, number | boolean | string>,
  ): Promise<any> {
    try {
      return await this.ec.v2PrivatePostOrderCreate(params);
    } catch (e) {
      console.error(e);
    }
  }

  async subscribeKlineV2(
    symbol: string,
    timeframe: string,
    limit: number,
  ) {
    await this.ec.loadMarkets();
    const id = this.ec.market(symbol).id;

    const timeframeBybit =
      Bybit.timeframes[timeframe as keyof typeof Bybit.timeframes];

    if (!(symbol in this.ohlcvs)) {
      this.ohlcvs = {
        ...this.ohlcvs,
        [symbol]: {},
      };
    }

    if (!(timeframe in this.ohlcvs[symbol])) {
      this.ohlcvs[symbol] = {
        ...this.ohlcvs[symbol],
        [timeframe]: [],
      };
    }

    this.onMessages.unshift((message) => {
      if (message.topic === `klineV2.${timeframeBybit}.${id}`) {
        log.debug("Receive message: ", { message });
        message?.data?.forEach((x: {
          open: number;
          close: number;
          high: number;
          low: number;
          volume: number;
          timestamp: number;
          confirm: boolean;
        }) => {
          if (timeframe === "all") {
            this.deltaKlineV2(symbol, timeframe, x, limit);
            return;
          }
          if (x?.confirm) {
            const timestamp = Math.round(x.timestamp / 1000);
            const ohlcvLen = this.ohlcvs[symbol][timeframe].length;
            if (ohlcvLen > 1) {
              const diff = timestamp -
                this.ohlcvs[symbol][timeframe][ohlcvLen - 1][0];
              if (
                diff <
                  Exchange
                      .timeframeSeconds[
                        timeframe as keyof typeof Exchange.timeframeSeconds
                      ] / 2
              ) {
                return;
              }
            }
            x.timestamp = timestamp;
            this.deltaKlineV2(symbol, timeframe, x, limit);
          }
        });
      }
    });
    this.ws.send(
      JSON.stringify({
        op: "subscribe",
        args: [`klineV2.${timeframeBybit}.${id}`],
      }),
    );
  }

  async subscribeOrderBookL2_25(symbol: string) {
    await this.ec.loadMarkets();
    const id = this.ec.market(symbol).id;
    this.onMessages.unshift((message) => {
      if (message.topic === `orderBookL2_25.${id}`) {
        log.debug("Receive message: ", { message });
        this.deltaOrderBookL2(symbol, message);
      }
    });
    this.ws.send(
      JSON.stringify({ op: "subscribe", args: [`orderBookL2_25.${id}`] }),
    );
  }

  async subscribePosition(
    symbol: string,
  ) {
    await this.ec.loadMarkets();
    this.onMessages.unshift((message) => {
      if (message.topic === "position") {
        log.debug("Receive message: ", { message });
        this.position = message.data[0];
      }
    });
    this.ws.send(JSON.stringify({ op: "subscribe", args: ["position"] }));
  }

  async subscribeTrade(
    symbol: string,
    limit: number,
  ) {
    await this.ec.loadMarkets();
    const id = this.ec.market(symbol).id;
    const timeframe = "1s";

    if (!(symbol in this.ohlcvs)) {
      this.ohlcvs = {
        ...this.ohlcvs,
        [symbol]: {},
      };
    }

    if (!(timeframe in this.ohlcvs[symbol])) {
      this.ohlcvs[symbol] = {
        ...this.ohlcvs[symbol],
        [timeframe]: [],
      };
    }

    this.onMessages.unshift((message) => {
      if (message.topic === `trade.${id}`) {
        log.debug("Receive message: ", { message });
        this.trade2Orders(symbol, message.data, limit);
      }
    });
    this.ws.send(JSON.stringify({ op: "subscribe", args: [`trade.${id}`] }));
  }

  trade2Orders(symbol: string, newData: {
    "timestamp": string;
    "trade_time_ms": number;
    "symbol": string;
    "side": string;
    "size": number;
    "price": number;
    "tick_direction": string;
    "trade_id": string;
    "cross_seq": number;
  }[], limit: number) {
    const timeframe = "1s";
    log.debug({ newData });
    newData?.forEach((data) => {
      const time = _.floor(data.trade_time_ms, -3);
      const len = this.ohlcvs[symbol][timeframe].length;
      const last = _.last(this.ohlcvs[symbol][timeframe]);
      if (last !== undefined && time === last[0]) {
        this.ohlcvs[symbol][timeframe][len - 1][2] = _.max([
          last[2],
          data.price,
        ]);
        this.ohlcvs[symbol][timeframe][len - 1][3] = _.min([
          last[3],
          data.price,
        ]);
        this.ohlcvs[symbol][timeframe][len - 1][4] = data.price;
        this.ohlcvs[symbol][timeframe][len - 1][5] += data.size;
      } else {
        this.ohlcvs[symbol][timeframe].push([
          time,
          data.price,
          data.price,
          data.price,
          data.price,
          data.size,
        ]);
      }
    });
    this.ohlcvs[symbol][timeframe] = _.takeRight(
      this.ohlcvs[symbol][timeframe],
      limit,
    );
  }

  deltaKlineV2(symbol: string, timeframe: string, newData: {
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    timestamp: number;
    confirm: boolean;
  }, limit: number) {
    this.ohlcvs[symbol][timeframe].push([
      newData.timestamp,
      newData.open,
      newData.high,
      newData.low,
      newData.close,
      newData.volume,
    ]);
    this.ohlcvs[symbol][timeframe] = _.takeRight(
      this.ohlcvs[symbol][timeframe],
      limit,
    );
  }

  deltaOrderBookL2(
    symbol: string,
    newData:
      | {
        type: "snapshot";
        data: Order[];
      }
      | {
        type: "delta";
        data: {
          insert: Order[];
          update: Order[];
          delete: Order[];
        };
      },
  ) {
    // Snapshot.
    if (newData.type === "snapshot") {
      log.debug("Snapshot item:", newData.data);
      this.orderBookL2[symbol] = newData.data;
      return;
    }

    // Delta.
    if (newData.type === "delta") {
      // insert.
      if (newData.data.insert.length > 0) {
        log.debug("Insert item:", newData.data.insert);
        this.orderBookL2[symbol] = [
          ...this.orderBookL2[symbol],
          ...newData.data.insert,
        ];
      }

      // update.
      _.forEach(newData.data.update, (x: Order) => {
        const itemToUpdate = _.find(
          this.orderBookL2[symbol],
          (d: Order) => d.id === x.id,
        );
        const updateData = { ...itemToUpdate, ...x };
        this.orderBookL2[symbol][
          this.orderBookL2[symbol].indexOf(itemToUpdate)
        ] = updateData;
        log.debug("Update item:", newData.data.update);
      });

      // delete.
      _.forEach(newData.data.delete, (x: Order) => {
        const itemToDelete = _.find(
          this.orderBookL2[symbol],
          (d: Order) => d.id === x.id,
        );
        if (itemToDelete) {
          this.orderBookL2[symbol] = _.without(
            this.orderBookL2[symbol],
            itemToDelete,
          );
          log.debug("Delete item:", newData.data.delete);
        }
      });
    }
  }

  async setTraidingStop(symbol: string, trailingStop: number): Promise<any> {
    console.log("[setTraidingStop] Set TraidingStop:", {
      trailingStop,
    });
    try {
      const id = this.ec.market(symbol).id;
      return await this.ec.v2PrivatePostPositionTradingStop({
        symbol: id,
        trailing_stop: trailingStop,
      });
    } catch (e) {
      console.error({ e });
    }
  }

  closePositionInterval(
    symbol: string,
    interval: number,
    takeProfitClose: number,
    closeDelta: number,
    params?: ccxt.Params,
  ): number {
    return setInterval(async () => {
      try {
        this.position = await this.fetchPositions([symbol], params);
      } catch (e) {
        console.log(e);
      }
      if (this.position.side === "None") {
        return;
      }
      const side = this.position.side;
      const size = Number(this.position.size);
      // deno-lint-ignore camelcase
      const entry_price = Number(this.position.entry_price);
      let profit = 0;
      let price = 0;

      if (side === "Buy") {
        price = this.getBestPrices(this.orderBookL2[symbol]).ask;
        profit = Math.round(price - entry_price);
      } else {
        price = this.getBestPrices(this.orderBookL2[symbol]).bid;
        profit = Math.round(entry_price - price);
      }

      console.log("[closePositionInterval]", {
        side,
        price,
        size,
        profit,
      });

      if (profit > takeProfitClose) {
        // Close position
        await this.setTraidingStop(symbol, closeDelta);
        return;
      }
    }, interval);
  }

  getBestPrices(
    orderBookL2: Order[],
  ): { ask: number; bid: number; spread: number } {
    const ask = _(orderBookL2)
      .filter((x: Order) => x.side === "Sell")
      .map((x: Order) => Number(x.price))
      .sort()
      .first();
    const bid = _(orderBookL2)
      .filter((x: Order) => x.side === "Buy")
      .map((x: Order) => Number(x.price))
      .sort()
      .last();
    const spread = ask - bid;

    return { ask, bid, spread };
  }
}
