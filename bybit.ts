import * as _ from "https://cdn.skypack.dev/lodash";
import * as ccxt from "https://esm.sh/ccxt";
import * as log from "https://deno.land/std/log/mod.ts";
import { Exchange } from "./exchange.ts";

export type Order = {
  id: number;
  symbol: string;
  price: string;
  side: string;
};

export type OrderBookL2 = {
  [key: string]: Order[];
};

export class Bybit extends Exchange {
  public orderBookL2: OrderBookL2 = {};

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
}
