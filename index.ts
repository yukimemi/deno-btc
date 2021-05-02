import * as ccxt from "https://esm.sh/ccxt";
import { postSlack } from "./mod.ts";
import { Exchange } from "./exchange.ts";
import { Bybit } from "./bybit.ts";
import { delay } from "https://deno.land/std/async/mod.ts";

const CHANNEL = "#bybit-test";
const FETCH_BALANCE_INTERVAL = 10_000;
const DELAY_INTERVAL = 10_000;
const LEVERAGE = 1.5;
const TRAILING_STOP = 50;
const TAKE_PROFIT = TRAILING_STOP * 2.0;
const STOP_LOSS = TRAILING_STOP * 4;
const INTERVAL = 5;
const PER_PAGE = 199;

const apiKey = Deno.env.get("CCXT_API_KEY") ?? "";
const secret = Deno.env.get("CCXT_API_SECRET") ?? "";
const testnet = !!Deno.env.get("TESTNET") ?? false;

const exc: Exchange = new Bybit(apiKey, secret, testnet);

const main = async (exc: Exchange) => {
  await exc.loadMarkets();
  exc.logBalanceInterval("BTC", FETCH_BALANCE_INTERVAL);
};

await main(exc);
