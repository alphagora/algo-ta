"use strict";

console.log("algo ta running…");

// import third party libraries
const moment = require('moment');
const talib = require('talib');
const gdax = require('gdax');

// declare global variables for data placeholder;
let client, data, analysis, backtest, results;

// default configuation variables
let _product = 'BTC-USD', 
    _interval = 86400, 
    _ta_indicator = 'EMA', 
    _ta_period = 20,
    _start_balance = 10000,
    _output = true,
    _poll = false;


// utility coinbase api wrapper to retrieve available historical prices 
// starts with today and goes back roughly 300 periods
// for the specified product.  Period interval is specified in seconds:
// 1m=60, 5m=300, 15m=900, 1h=3600, 6h=21600, 1d=86400
// returns a Promise to support flexible execution including await, then(), etc.
async function prices(product, interval) {
    return new Promise(function (resolve, reject) {
        client.getProductHistoricRates(product, {granularity:interval}, function(err, resp) {
            if(!err) {
                let result = JSON.parse(resp.body);
                let time = [], open = [], high = [], low = [], close = [], volume = [];
                for (let i=result.length-1; i>=0; i--) {
                    time.push(moment.unix(result[i][0]).utc().format('YYYY-MM-DD H:mm:ss'));
                    low.push(parseFloat(result[i][1]));
                    high.push(parseFloat(result[i][2]));
                    open.push(parseFloat(result[i][3]));
                    close.push(parseFloat(result[i][4]));
                    volume.push(parseFloat(result[i][5]));
                }
                resolve({time, high, low, open, close, volume});
            }
            else reject(err);
        });
    });
}

// utility talib wrapper to calculate an indicator by name
// for a given period and set of historical prices
// returns a Promise to support flexible execution including await, then(), etc.
async function calculate(name, period, prices) {
    return new Promise(function (resolve, reject) {
        talib.execute({
            name: name,
            startIdx: 0,
            endIdx: prices.close.length - 1,
            inReal: prices.close,
            optInTimePeriod: period
        }, function (err, result) {
            if (!err) {
                let analysis = [];
                let emas = result.result.outReal;
                for (let i = result.begIndex; i<data.close.length; i++) {
                    analysis.push({time:data.time[i], close:data.close[i], ema:emas[i-result.begIndex]});
                }
                resolve(analysis);
            }   
            else reject(err);
        });
    });
}

// initalize all the local variables;
function init() {
    client = new gdax.PublicClient();
}

// loads all the historical price data
async function load() {
    if (!client) init();
    data = await prices(_product, _interval);
}

// perform technical analysis on the loaded prices
async function analyze() {
    if (!data) await load();
    analysis = await calculate(_ta_indicator, _ta_period, data);
}

// backtest the analysis
async function test(start) {
    if (!analysis) await analyze();

    // initialize backtest array
    backtest = [];

    // set accuracy variables
    let accurate = 0;

    // loop through the calculated data to track performance
    for (let i=0; i<analysis.length; i++) {
        let actual = 'sell';
        let signal = 'sell';

        // set the starting balance (hodl vs ema)
        if (i==0) {
            analysis[i]['hodl_bal'] = start;
            analysis[i]['ema_bal'] = start;
        }
        else {
            // identify the actual signal and calculate hodl balance
            if (analysis[i].close > analysis[i-1].close) actual = 'buy';
            analysis[i].hodl_bal = (analysis[i].close/analysis[i-1].close)*analysis[i-1].hodl_bal;

            // calculate the ema signal and balance
            if (analysis[i-1].close > analysis[i-1].ema) {
                signal = 'buy';
                analysis[i].ema_bal = (analysis[i].close/analysis[i-1].close)*analysis[i-1].ema_bal;
            }
            else analysis[i].ema_bal = analysis[i-1].ema_bal;

            // check signal accuracy 
            if (actual == signal) accurate++;
        }
        // load backtest data
        backtest.push({time:analysis[i].time, close:analysis[i].close, ema:analysis[i].ema, 
                       hodl_balance:analysis[i].hodl_bal, ema_balance:analysis[i].ema_bal, 
                       actual:actual, signal:signal});
   }
   
    // set the aggregated results
    results = {accuracy:accurate/(analysis.length-1)};
}

// aggregate the results of the backtest and store in a results object
async function summarize() {
    if (!backtest) await test(_start_balance);
    if (results) {
        results['hodl_balance'] = backtest[backtest.length-1].hodl_balance;
        results['ema_balance'] = backtest[backtest.length-1].ema_balance;
        results['hodl_return'] = (results['hodl_balance'] - _start_balance) / _start_balance;
        results['ema_return'] = (results['ema_balance'] - _start_balance) / _start_balance;
    }
}

// prints the backtest and results to the console
// tab delimited for easy copy/paste import 
// into a spreadsheet for further analysis
async function print() {
    if (!results) await summarize();
    console.log("time", "\t", "close", "\t", "ema", "\t", "hodl_balance", "\t", "ema_balance", 
                "\t", "actual", "\t", "signal"); 
    for (let i=0; i<backtest.length; i++) {
        console.log(backtest[i].time, "\t", backtest[i].close, "\t", backtest[i].ema, "\t", 
                    backtest[i].hodl_balance, "\t", backtest[i].ema_balance, "\t", 
                    backtest[i].actual, "\t", backtest[i].signal); 
    }
    console.log(results);
}

// poll the data and spit out the results
async function poll() {
    if (!results) await summarize();
    if (_output) await print();
    console.log(moment().utc().format('YYYY-MM-DD H:mm:ss'), '-', _product, 
                'current signal:', backtest[backtest.length-1].signal);
}

// poll now then repeat per the specified interval (in milliseconds)
// 
// FYI.. The Coinbase API specifically recommends against 
// polling the getProductHistoricRates endpoint at high 
// frequencies.  So if you're writing a higher frequency (intra-day) 
// algo rather use the getProductTicker endpoint 
// which returns the last tick for the specified interval.
// Refactor the prices function to check if data already
// exists and if so, get the last tick and append your existing 
// historical data and return the new results
function run() {
    poll();
    if (_poll) timer = setInterval(_interval*1000, poll());
}

// go...
run();