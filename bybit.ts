import * as ccxt from "https://esm.sh/ccxt";
import { Exchange } from "./exchange.ts";

export class Bybit extends Exchange {
  constructor(apiKey: string, secret: string, testnet: boolean = false) {
    super(apiKey, secret);
    this.ec = new ccxt.bybit({ apiKey, secret, enableRateLimit: true });

    if (testnet) {
      this.ec.urls.api = this.ec.urls.test;
    }
  }
}
