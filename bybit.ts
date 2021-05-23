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
        if (message?.data[0]?.confirm) {
          this.deltaKlineV2(symbol, timeframe, message.data[0]);
        }
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
    this.onMessages.push((message) => {
      if (message.topic === "position") {
        log.debug("Receive message: ", { message });
        this.position = message.data[0];
      }
    });
    this.ws.send(JSON.stringify({ op: "subscribe", args: ["position"] }));
  }

  deltaKlineV2(symbol: string, timeframe: string, newData: {
    open: number;
    close: number;
    high: number;
    low: number;
    volume: number;
    timestamp: number;
    confirm: boolean;
  }) {
    const timestamp = Math.round(newData.timestamp / 1000);
    this.ohlcvs[symbol][timeframe].push([
      timestamp,
      newData.open,
      newData.high,
      newData.low,
      newData.close,
      newData.volume,
    ]);
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
    delta: number,
    closeDelta: number,
    orderStopProfit: number,
    params?: ccxt.Params,
  ): number {
    return setInterval(async () => {
      this.position = await this.fetchPositions([symbol], params);
      if (this.position.side === "None") {
        this.fixedOrders = [];
        this.buyStop = false;
        this.sellStop = false;
        return;
      }
      const side = this.position.side;
      const size = Number(this.position.size);
      // deno-lint-ignore camelcase
      const entry_price = Number(this.position.entry_price);

      log.debug({ openOrders: this.openOrders });
      if (side === "Buy") {
        const minPrice = entry_price + delta;
        const ask = this.getBestPrices(this.orderBookL2[symbol]).ask;
        const price = Math.round(minPrice > ask ? minPrice : ask);
        const profit = Math.round(ask - entry_price);

        this.sellStop = false;
        if (profit < orderStopProfit) {
          this.buyStop = true;
          this.openOrders
            .filter((x) => x.side === "buy")
            .forEach((x) => {
              this.cancelOrder(x?.id, symbol);
            });
        } else {
          this.buyStop = false;
        }

        console.log("[closePositionInterval]", {
          side: "sell",
          price,
          size,
          profit,
        });

        if (ask - entry_price > closeDelta) {
          // Close position
          await this.setTraidingStop(symbol, 5);
          return;
        }

        const isFixed = this.fixedOrders.some(
          (x) =>
            x?.symbol === symbol &&
            x?.side === "sell" &&
            x?.price === price &&
            x?.amount === size,
        );

        if (isFixed) return;
        this.fixedOrders.forEach(
          async (x) => await this.cancelOrder(x?.id, symbol),
        );
        this.fixedOrders = [];

        console.log("[closePositionInterval] Sell:", { size, price });
        const order = await this.createLimitSellOrder(symbol, size, price, {
          time_in_force: "PostOnly",
        });
        if (order) this.fixedOrders.push(order);
      } else {
        const minPrice = entry_price - delta;
        const bid = this.getBestPrices(this.orderBookL2[symbol]).bid;
        const price = Math.round(minPrice < bid ? minPrice : bid);
        const profit = Math.round(entry_price - bid);

        this.buyStop = false;
        if (profit < orderStopProfit) {
          this.sellStop = true;
          this.openOrders
            .filter((x) => x.side === "sell")
            .forEach((x) => {
              this.cancelOrder(x?.id, symbol);
            });
        } else {
          this.sellStop = false;
        }

        console.log("[closePositionInterval]", {
          side: "buy",
          price,
          size,
          profit,
        });

        if (entry_price - bid > closeDelta) {
          // Close position
          await this.setTraidingStop(symbol, 5);
          return;
        }

        const isFixed = this.fixedOrders.some(
          (x) =>
            x.symbol === symbol &&
            x.side === "buy" &&
            x.price === price &&
            x.amount === size,
        );

        if (isFixed) return;
        this.fixedOrders.forEach(
          async (x) => await this.cancelOrder(x.id, symbol),
        );
        this.fixedOrders = [];

        console.log("[closePositionInterval] Buy:", { size, price });
        const order = await this.createLimitBuyOrder(symbol, size, price, {
          time_in_force: "PostOnly",
        });
        if (order) this.fixedOrders.push(order);
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
