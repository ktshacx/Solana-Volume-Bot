const { parentPort, workerData } = require('worker_threads');
const Task = require('./models/taskModel');
const User = require('./models/userModel');
const { connectDB, connection, config } = require('./config');
const { LAMPORTS_PER_SOL, VersionedTransaction, Keypair, PublicKey, TransactionMessage, SystemProgram, sendAndConfirmTransaction } = require('@solana/web3.js');
const jito = require('jito-ts');
const TelegramBot = require('node-telegram-bot-api');
const dotenv = require('dotenv');
const { genWallet, getPrice, getBalance } = require('./helpers/walletHelper');
const { Transaction } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
dotenv.config();

connectDB();

let errorCount = 0;

const bot = new TelegramBot(process.env.BOT_TOKEN);

const NATIVE_TOKEN = "So11111111111111111111111111111111111111112";
const EXCLUDE_DEXES = [
    "Oasis", "Cropper", "Stabble Weighted Swap", "Openbook", "Saber", "Perps", 
    "Orca V1", "Phoenix", "Raydium CLMM", "Helium Network", "Raydium CP", 
    "Bonkswap", "Lifinity V1", "Pump.fun", "OpenBook V2", "Orca V2", "Aldrin V2", 
    "Raydium", "Saros", "Dexlab", "Whirlpool", "Cropper Legacy", "Fox", 
    "Stabble Stable Swap", "Lifinity V2", "Obric V2", "StepN", "Mercurial", 
    "Aldrin", "Saber (Decimals)", "Crema", "Invariant", "Moonshot", 
    "1DEX", "FluxBeam", "Sanctum Infinity", "Guacswap", 
    "Penguin", "Token Swap", "Sanctum"
];

async function swapQuote(token, amount, isBuy, slippage = 50) {
    try {
        const api = `https://quote-api.jup.ag/v6/quote?inputMint=${isBuy ? NATIVE_TOKEN : token}&outputMint=${!isBuy ? NATIVE_TOKEN : token}&amount=${amount}&slippageBps=${slippage}&excludeDexes=${EXCLUDE_DEXES.join(',')}`;
        const quoteResponse = await (await fetch(api)).json();
        return quoteResponse;
    } catch (error) {
        console.error("Error fetching quote:", error);
        errorCount++;
        checkForErrorLimit();
        return null;
    }
}

async function swap(quote, wallet) {
    try {
        const body = JSON.stringify({
            quoteResponse: quote,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
        });

        const response = await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        const data = await response.json();

        if(data.swapTransaction) {
            const swapTransactionBuf = Buffer.from(data.swapTransaction, 'base64');
            let transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([wallet]);
            return transaction;
        }

        return null;
    } catch (e) {
        errorCount++;
        checkForErrorLimit();
        console.log(e);
    }
}

async function distributeFunds(mainWallet, distribuitonAddresses) {
    const c = jito.searcher.searcherClient('amsterdam.mainnet.block-engine.jito.wtf');
    const tipAccount = new PublicKey((await c.getTipAccounts())[0]);

    let isLeaderSlot = false;
    while (!isLeaderSlot) {
        const next_leader = await c.getNextScheduledLeader();
        const num_slots = next_leader.nextLeaderSlot - next_leader.currentSlot;
        isLeaderSlot = num_slots <= 2;
        console.log(`next jito leader slot in ${num_slots} slots`);
        await new Promise((r) => setTimeout(r, 500));
    }

    let latestBlockhash = await connection.getLatestBlockhash();
    const b = new jito.bundle.Bundle([], 5);

    let txns = [];

    for(let i = 0; i < distribuitonAddresses.length; i++){
        let transferFunds = SystemProgram.transfer({
            fromPubkey: mainWallet.publicKey,
            toPubkey: new PublicKey(distribuitonAddresses[i]),
            lamports: (task.amount * 2 * LAMPORTS_PER_SOL) + (0.002 * LAMPORTS_PER_SOL),
        });

        let transferFundsVersionedTx = new VersionedTransaction(
            new TransactionMessage({
                payerKey: mainWallet.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [transferFunds],
            }).compileToV0Message()
        )

        transferFundsVersionedTx.sign([mainWallet]);
        txns.push(transferFundsVersionedTx);
    }

    b.addTransactions(...txns);
    b.addTipTx(mainWallet, 100_000, tipAccount, latestBlockhash.blockhash);
    const tx = await c.sendBundle(b);
    const bundleResult = await onBundleResult(c);
    return bundleResult;
}


async function buySell(wallet, token, amount) {
    const c = jito.searcher.searcherClient('amsterdam.mainnet.block-engine.jito.wtf');
    const tipAccount = new PublicKey((await c.getTipAccounts())[0]);

    let isLeaderSlot = false;
    while (!isLeaderSlot) {
        const next_leader = await c.getNextScheduledLeader();
        const num_slots = next_leader.nextLeaderSlot - next_leader.currentSlot;
        isLeaderSlot = num_slots <= 2;
        console.log(`next jito leader slot in ${num_slots} slots`);
        await new Promise((r) => setTimeout(r, 500));
    }

    let latestBlockhash = await connection.getLatestBlockhash();
    const b = new jito.bundle.Bundle([], 5);

    const buyQuote = await swapQuote(token, amount, true);
    const buyTx = await swap(buyQuote, wallet);

    const sellQuote = await swapQuote(token, buyQuote.outAmount, false);
    const sellTx = await swap(sellQuote, wallet);

    if(buyTx && sellTx){
        b.addTransactions(buyTx, sellTx);
        b.addTipTx(wallet, 100_000, tipAccount, latestBlockhash.blockhash);
        const tx = await c.sendBundle(b);
        const bundleResult = await onBundleResult(c);
        return bundleResult;
    }
}

async function pooler() {
    try {
        let task = await Task.findOne({ taskid: workerData[0] });
        let user = await User.findOne({ userid: task.userid });

        const token = new PublicKey(workerData[1]);
        const wallet = Keypair.fromSecretKey(new Uint8Array(user.private_key.split(',').map(Number)));

        let balance = await connection.getBalance(wallet.publicKey);
        let swapAmount = Math.floor(task.amount * LAMPORTS_PER_SOL);

        if (balance < swapAmount + (0.002 * LAMPORTS_PER_SOL)) {
            await Task.updateOne({ taskid: workerData[0] }, { isRunning: false });
            bot.sendMessage(user.userid, `⭕ <code>${task.token}</code> - Insufficient Balance, add at least ${((swapAmount * config.walletLimit + (0.002 * LAMPORTS_PER_SOL)) / LAMPORTS_PER_SOL).toFixed(3)} SOL to start bot.`, { parse_mode: 'HTML' });
        }

        // let distributionWallets = [];
        // task.wallets.forEach((w) => {
        //     wallets.push(w.address);
        // })

        // let distributeFundsResult = await distributeFunds(wallet, distributionWallets);
        // if(distributeFundsResult) {
            
        // }

        while (true) {
            task = await Task.findOne({ taskid: workerData[0] });
            if (!task.isRunning) {
                await new Promise((r) => setTimeout(r, 5000));
                continue;
            }

            if (task.volumeMade >= task.target) {
                await Task.updateOne({ taskid: workerData[0] }, { isRunning: false });
                bot.sendMessage(user.userid, `🚀 <code>${task.token}</code> - Target Reached`, { parse_mode: 'HTML' });
                break;
            }

            const c = jito.searcher.searcherClient('amsterdam.mainnet.block-engine.jito.wtf');
            const tipAccount = new PublicKey((await c.getTipAccounts())[0]);

            let isLeaderSlot = false;
            while (!isLeaderSlot) {
                const next_leader = await c.getNextScheduledLeader();
                const num_slots = next_leader.nextLeaderSlot - next_leader.currentSlot;
                isLeaderSlot = num_slots <= 2;
                console.log(`next jito leader slot in ${num_slots} slots`);
                await new Promise((r) => setTimeout(r, 500));
            }

            let latestBlockhash = await connection.getLatestBlockhash();
            const b = new jito.bundle.Bundle([], 10);

            const buyQuote = await swapQuote(token, swapAmount, true);
            const buyTx = await swap(buyQuote, wallet);

            const sellQuote = await swapQuote(token, buyQuote.outAmount, false);
            const sellTx = await swap(sellQuote, wallet);

            if(buyTx && sellTx){
                const taxTxInstructions = SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: new PublicKey(config.tax_wallet),
                    lamports: swapAmount * 2 * config.botTax,
                });
            
                const taxTxMessage = new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: [taxTxInstructions],
                }).compileToV0Message();
            
                const taxTx = new VersionedTransaction(taxTxMessage);
                taxTx.sign([wallet]);

                b.addTransactions(buyTx, sellTx, taxTx);
                b.addTipTx(wallet, 100_000, tipAccount, latestBlockhash.blockhash);

                const tx = await c.sendBundle(b);
                console.log('Bundle ID: '+tx);
                const bundleResult = await onBundleResult(c);
                console.log(bundleResult);

                if(bundleResult == true || bundleResult == 1){
                    let vol = task.volumeMade;
                    let volMade = getPrice(swapAmount / LAMPORTS_PER_SOL) * 2;
                    await Task.updateOne({ taskid: workerData[0] }, {volumeMade: vol + volMade});
                }
            }
        }
    } catch (e) {
        errorCount++;
        checkForErrorLimit();
        console.log(e);
    }
}

const onBundleResult = async (c) => {
    let first = 0;
    let isResolved = false; 

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(first);
            isResolved = true
        }, 30000);

        c.onBundleResult(
            (result) => {
                if (isResolved) return first;

                const bundleId = result.bundleId;
                const isAccepted = result.accepted;
                const isRejected = result.rejected;

                if (isResolved == false){
                    if (isAccepted) {
                        console.log(
                          "bundle accepted, ID:",
                          bundleId,
                          " Slot: ",
                          result.accepted.slot
                        );
                        first +=1;
                        isResolved = true;
                        resolve(first);
                    }

                    if (isRejected) {
                        console.log("bundle is Rejected:", result);
                    }
                }
            },
            (e) => {
                console.log(e);
            }
        )
    })
}

async function checkForErrorLimit(){
    if(errorCount >= 3){
        let task = await Task.findOne({taskid: workerData[0]});
        await Task.updateOne({taskid: workerData[0]}, {isRunning: false});
        bot.sendMessage(task.userid, '❌ Bot stopped unexpectedly, please check balance and other details, if error persists then contact dev.')
    }
}

pooler();