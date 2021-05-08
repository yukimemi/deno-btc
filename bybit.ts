import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
import _ from "https://cdn.skypack.dev/lodash";
import { Exchange } from "./exchange.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
import { red, bold, underline } from "https://deno.land/std/fmt/colors.ts";

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
  public orderBookL2: OrderBookL2 = {};
  public position = {
    side: "",
    size: 0,
    entry_price: "",
    take_profit: "",
    stop_loss: "",
  };
  public positionSizeMax = 0;

  constructor(apiKey: string, secret: string, testnet: boolean = false) {
    super(apiKey, secret);
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
    this.position = JSON.parse(res).result[0].data;
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
    return true;
  }

  async v2PrivatePostOrderCreate(
    params: Record<string, number | boolean | string>
  ): Promise<any> {
    try {
      return await this.ec.v2PrivatePostOrderCreate(params);
    } catch (e) {
      console.error(e);
    }
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
      JSON.stringify({ op: "subscribe", args: [`orderBookL2_25.${id}`] })
    );
  }

  async subscribePosition(
    symbol: string,
    profit: number,
    loss: number,
    delta: number
  ) {
    await this.ec.loadMarkets();
    const id = this.ec.market(symbol).id;
    let before = {
      side: "",
      size: 0,
      // deno-lint-ignore camelcase
      entry_price: 0,
      // deno-lint-ignore camelcase
      take_profit: 0,
      // deno-lint-ignore camelcase
      stop_loss: 0,
    };
    this.onMessages.push(async (message) => {
      if (message.topic === "position") {
        log.debug("Receive message: ", { message });
        // Set take profit and stop loss.
        this.position = message.data[0];
        if (this.position.side === "None") return;
        const side = this.position.side;
        const size = Number(this.position.size);
        // deno-lint-ignore camelcase
        const entry_price = Number(this.position.entry_price);
        // deno-lint-ignore camelcase
        const take_profit = Number(this.position.take_profit);
        // deno-lint-ignore camelcase
        const stop_loss = Number(this.position.stop_loss);
        if (
          before.side === side &&
          before.size === size &&
          before.entry_price === entry_price &&
          before.take_profit === take_profit &&
          before.stop_loss === stop_loss
        ) {
          return;
        }
        before = {
          side,
          size,
          entry_price,
          take_profit,
          stop_loss,
        };
        if (side === "Buy") {
          const minPrice = entry_price + delta;
          const ask = this.getBestPrices(this.orderBookL2[symbol]).ask;
          const price = Math.round(minPrice > ask ? minPrice : ask);

          const fixedOrders = this.fixedOrders.filter(
            (x) =>
              x.symbol === symbol &&
              x.side === "sell" &&
              x.price === price &&
              x.amount === size
          );

          if (fixedOrders.length > 0) {
            console.log("[Position] Already ordered:", {
              side: "sell",
              price,
              size,
              profit: Math.round(ask - entry_price),
            });
            return;
          }
          this.fixedOrders.forEach(
            async (x) => await this.cancelOrder(x.id, symbol)
          );
          this.fixedOrders = [];

          console.log(underline(bold(red("[Position] Sell:"))), {
            size,
            price,
          });
          this.fixedOrders.push(
            await this.v2PrivatePostOrderCreate({
              symbol: id,
              side: "Sell",
              order_type: "Limit",
              qty: size,
              price,
              time_in_force: "PostOnly",
              reduce_only: true,
            })
          );
        } else {
          const minPrice = entry_price - delta;
          const bid = this.getBestPrices(this.orderBookL2[symbol]).bid;
          const price = Math.round(minPrice < bid ? minPrice : bid);

          const fixedOrders = this.fixedOrders.filter(
            (x) =>
              x.symbol === symbol &&
              x.side === "buy" &&
              x.price === price &&
              x.amount === size
          );

          if (fixedOrders.length > 0) {
            console.log("[Position] Already ordered:", {
              side: "buy",
              price,
              size,
              profit: Math.round(entry_price - bid),
            });
            return;
          }
          this.fixedOrders.forEach(
            async (x) => await this.cancelOrder(x.id, symbol)
          );
          this.fixedOrders = [];

          console.log(underline(bold(red("[Position] Buy:"))), {
            size,
            price,
          });
          this.fixedOrders.push(
            await this.v2PrivatePostOrderCreate({
              symbol: id,
              side: "Buy",
              order_type: "Limit",
              qty: size,
              price,
              time_in_force: "PostOnly",
              reduce_only: true,
            })
          );
        }

        {
          // deno-lint-ignore camelcase
          const take_profit = Math.round(
            this.position.side === "Buy"
              ? entry_price + profit
              : entry_price - profit
          );
          // deno-lint-ignore camelcase
          const stop_loss = Math.round(
            this.position.side === "Buy"
              ? entry_price - loss
              : entry_price + loss
          );
          if (
            Number(this.position.take_profit) !== take_profit ||
            Number(this.position.stop_loss) !== stop_loss
          ) {
            console.log("Set TraidingStop:", { take_profit, stop_loss });
            try {
              await this.ec.v2PrivatePostPositionTradingStop({
                symbol: id,
                take_profit,
                stop_loss,
              });
              await delay(3_000);
            } catch (e) {
              console.error({ e });
            }
          }
        }
      }
    });
    this.ws.send(JSON.stringify({ op: "subscribe", args: ["position"] }));
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
        }
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
          (d: Order) => d.id === x.id
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
          (d: Order) => d.id === x.id
        );
        if (itemToDelete) {
          this.orderBookL2[symbol] = _.without(
            this.orderBookL2[symbol],
            itemToDelete
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
    params?: ccxt.Params
  ): number {
    return setInterval(async () => {
      const id = this.ec.market(symbol).id;
      this.position = await this.fetchPositions([symbol], params);
      if (this.position.side === "None") {
        this.fixedOrders = [];
        return;
      }
      const side = this.position.side;
      const size = Number(this.position.size);
      // deno-lint-ignore camelcase
      const entry_price = Number(this.position.entry_price);

      console.log({ openOrders: this.openOrders });
      if (side === "Buy") {
        const minPrice = entry_price + delta;
        const ask = this.getBestPrices(this.orderBookL2[symbol]).ask;
        const price = Math.round(minPrice > ask ? minPrice : ask);

        if (ask - entry_price > closeDelta) {
          // Close position
          await this.setTraidingStop(symbol, 5);
          return;
        }

        const fixedOrders = this.fixedOrders.filter(
          (x) =>
            x.symbol === symbol &&
            x.side === "sell" &&
            x.price === price &&
            x.amount === size
        );

        if (fixedOrders.length > 0) {
          console.log("[closePositionInterval] Already ordered:", {
            side: "sell",
            price,
            size,
            profit: Math.round(ask - entry_price),
          });
          return;
        }
        this.fixedOrders.forEach(
          async (x) => await this.cancelOrder(x.id, symbol)
        );
        this.fixedOrders = [];

        console.log("[closePositionInterval] Sell:", { size, price });
        this.fixedOrders.push(
          await this.v2PrivatePostOrderCreate({
            symbol: id,
            side: "Sell",
            order_type: "Limit",
            qty: size,
            price,
            time_in_force: "PostOnly",
            reduce_only: true,
          })
        );
      } else {
        const minPrice = entry_price - delta;
        const bid = this.getBestPrices(this.orderBookL2[symbol]).bid;
        const price = Math.round(minPrice < bid ? minPrice : bid);

        if (entry_price - bid > closeDelta) {
          // Close position
          await this.setTraidingStop(symbol, 5);
          return;
        }

        const fixedOrders = this.fixedOrders.filter(
          (x) =>
            x.symbol === symbol &&
            x.side === "buy" &&
            x.price === price &&
            x.amount === size
        );

        if (fixedOrders.length > 0) {
          console.log("[closePositionInterval] Already ordered:", {
            side: "buy",
            price,
            size,
            profit: Math.round(entry_price - bid),
          });
          return;
        }
        this.fixedOrders.forEach(
          async (x) => await this.cancelOrder(x.id, symbol)
        );
        this.fixedOrders = [];

        console.log("[closePositionInterval] Buy:", { size, price });
        this.fixedOrders.push(
          await this.v2PrivatePostOrderCreate({
            symbol: id,
            side: "Buy",
            order_type: "Limit",
            qty: size,
            price,
            time_in_force: "PostOnly",
            reduce_only: true,
          })
        );
      }
    }, interval);
  }

  getBestPrices(
    orderBookL2: Order[]
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
