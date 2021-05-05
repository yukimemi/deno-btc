import _ from "https://cdn.skypack.dev/lodash";
import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
import { delay } from "https://deno.land/std/async/mod.ts";
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
  public orderBookL2: OrderBookL2 = {};
  public position = {
    side: "",
    size: 0,
    entry_price: 0,
    take_profit: 0,
    stop_loss: 0,
  };

  constructor(apiKey: string, secret: string, testnet: boolean = false) {
    super(apiKey, secret);
    this.ec = new ccxt.bybit({ apiKey, secret, enableRateLimit: true });

    if (testnet) {
      this.ec.urls.api = this.ec.urls.test;
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
          const price = entry_price + delta;
          console.log("[Position] Sell:", { size, price });
          await this.createLimitSellOrder(symbol, size, price, {
            time_in_force: "PostOnly",
          });
        } else {
          const price = entry_price - delta;
          console.log("[Position] Buy:", { size, price });
          await this.createLimitBuyOrder(symbol, size, price, {
            time_in_force: "PostOnly",
          });
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
