const TelegramBot = require('node-telegram-bot-api');
const { connectDB, config, connection } = require('./config');
const dotenv = require('dotenv');
const { genWallet, getBalance, getPrice, formatNumber } = require('./helpers/walletHelper');
const User = require('./models/userModel');
const { LAMPORTS_PER_SOL, sendAndConfirmTransaction } = require('@solana/web3.js');
const Task = require('./models/taskModel');
const { getTokenDetails } = require('./helpers/tokenHelper');
const { Worker } = require('worker_threads');
const { uuid } = require('uuidv4');
const { Keypair } = require('@solana/web3.js');
const { ComputeBudgetProgram } = require('@solana/web3.js');
const { SystemProgram } = require('@solana/web3.js');
const { Transaction } = require('@solana/web3.js');
const { PublicKey } = require('@solana/web3.js');
dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});
connectDB();
let tasks = {};
let userInput = {};
let workerArray = [];

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    let user = await User.findOne({userid: chatId});
    if(!user){
        let wallet = genWallet();
        user = new User({
            userid: chatId,
            wallet_address: wallet.publicKey.toBase58(),
            private_key: wallet.secretKey.toString()
        })
        await user.save();
    }
    let balance = await getBalance(user.wallet_address);
    bot.sendMessage(
        chatId,
        `Welcome to <b>ScumBooster Volume Bot</b>\n\n` +
        `Here is your SOL deposit address: <code>${user.wallet_address}</code>\n` +
        `Balance: <code>${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL</code>\n\n` +
        `Send or paste any token address to get details.\n\n<i>Developed with ❤️ by @cryptonega</i>`,
        { parse_mode: 'HTML', reply_to_message_id: msg.message_id}
    );
})

bot.onText(/^[1-9A-Za-z]{42,44}$/, async (msg) => {
    const chatId = msg.chat.id;
    const address = msg.text;
    let user = await User.findOne({userid: chatId});
    if(!user){
        let wallet = genWallet();
        user = new User({
            userid: chatId,
            wallet_address: wallet.publicKey.toBase58(),
            private_key: wallet.secretKey.toString()
        })
        await user.save();
    }
    let dexData = await getTokenDetails(address);
    if(dexData){
    let balance = await getBalance(user.wallet_address);
    let task = await Task.findOne({userid: chatId, address: address});
    let volumeMade = 0;
    let runningStatus = false;
    if(!task) {
        let walletArray = [];
        for(let i = 0; i < config.walletLimit; i++){
            let w = genWallet();
            walletArray.push({address: w.publicKey.toBase58(), private_key: w.secretKey.toString()});
        }
        task = new Task({
            taskid: uuid(),
            userid: chatId,
            address: address,
            isRunning: false,
            volumeMade: 0,
            token: dexData.baseToken.address,
            target: 1_000_000,
            amount: 0.01,
            wallets: walletArray
        })
        await task.save();
    }
    volumeMade = task.volumeMade.toFixed(2);
    runningStatus = task.isRunning;
    let keyboard = [
        [
            {text: !runningStatus ? '🚀 Start Bot' : '⏯️ Pause', callback_data: !runningStatus ? `start_${task.taskid}` : `pause_${task.taskid}`},
        ],
        [
            {text: `🔸 Target Volume - $${formatNumber(task.target)}`, callback_data: `target_${task.taskid}`},
            {text: `💲 Buy/Sell Amount - ${task.amount.toFixed(3)} SOL`, callback_data: `amount_${task.taskid}`},
        ],
        [
            {text: '🔃 Refresh', callback_data: task.taskid ? `refresh_${task.taskid}` : `refresh`},
            // {text: '🚧 Gather Balance', callback_data: `gather_${task.taskid}`},
        ]
    ]
    bot.sendMessage(chatId, `
⭕ <b>Token Address:</b> <code>${address}</code>
🔆 <b>Name:</b> ${dexData.baseToken.name}
🔆 <b>Symbol:</b> ${dexData.baseToken.symbol}

<b>Market Data:</b>
➕ <b>Dex:</b> ${dexData.dexId}
➕ <b>Price:</b> $${dexData.priceUsd}

<b>Volume:</b>
➕ <b>24h:</b> $${dexData.volume.h24}
➕ <b>6h:</b> $${dexData.volume.h6}
➕ <b>1h:</b> $${dexData.volume.h1}
➕ <b>5m:</b> $${dexData.volume.m5}

➕ <b>Market Cap:</b> $${dexData.marketCap}

💠 <b>Deposit Address:</b> <code>${user.wallet_address}</code>
▶️ <b>Balance:</b> <code>${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL</code>

⏯️ <b>Bot Generated Volume:</b> $${volumeMade}
    `, {
            reply_markup: {
                inline_keyboard: keyboard,
            },
            reply_to_message_id: msg.message_id,
            parse_mode: 'HTML'
    });
}else{
    bot.sendMessage(chatId, '❌ Only Meteora and Raydium tokens are allowed.', {reply_to_message_id: msg.message_id});
}
})

bot.onText(/\/help/, async (msg, match) => {
    const helpMessage = `
<b><u>ScumBooster Volume Bot - Help Menu</u></b>

<b>Commands:</b>
  <b>/start</b> - Start the bot and create a wallet if none exists.
  <b>/help</b> - Display this help message.
  <b>/withdraw [address] [amount]</b> - Withdraw the specified amount to a given wallet address.

<b>How to Use:</b>
- <i>Send any token address to view details</i> about it, including price, volume, and market cap.
- <i>Use inline buttons</i> to start or pause the bot, set target volume, adjust buy/sell amount, or gather balance.

<b>Key Functions:</b>
🚀 <b>Start Bot</b> - Initiates volume bot activity.
⏯️ <b>Pause</b> - Pauses the bot.
🔸 <b>Target Volume</b> - Set the desired target volume.
💲 <b>Buy/Sell Amount</b> - Adjust the trade amount in SOL.
🔃 <b>Refresh</b> - Update current balance and volume data.

<b>Note:</b> Ensure a minimum balance of <b>0.05 SOL</b> for bot operations.

<i>Developed with ❤️ by @cryptonega</i>
`;
    bot.sendMessage(msg.chat.id, helpMessage,{reply_to_message_id: msg.message_id, parse_mode: 'HTML'});
})

bot.onText(/\/withdraw\s+([a-zA-Z0-9]{32,44})\s+([0-9]*\.?[0-9]+)\s*$/, async (msg, match) => {
    let w = match[1];
    let amount = match[2];
    let chatId = msg.chat.id;

    let m = await bot.sendMessage(chatId, '🔃 Wait processing...', {reply_to_message_id: msg.message_id});

    try {
        let address = new PublicKey(w);
        amount = Number(amount);
        let user = await User.findOne({userid: chatId});
        let wallet = Keypair.fromSecretKey(new Uint8Array(user.private_key.split(',').map(Number)));
        let balance = await getBalance(user.wallet_address);
        if(balance >= amount * LAMPORTS_PER_SOL){
            let transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: address,
                    lamports: amount * LAMPORTS_PER_SOL,
                })
            );

            let txSignature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [wallet]
            );

            bot.editMessageText(`✅ Successfully sent, <code>${txSignature}</code>`, {chat_id: chatId, message_id: m.message_id, parse_mode: 'HTML'})
        }else{
            bot.editMessageText('❌ Insufficient balance', {chat_id: chatId, message_id: m.message_id, parse_mode: 'HTML'});
        }
    } catch (err) {
        bot.editMessageText('❌ '+ err.message, {chat_id: chatId, message_id: m.message_id, parse_mode: 'HTML'});
    }
})

bot.on('message', async (msg) => {
    let chatId = msg.chat.id;
    if(userInput[chatId]){
        let {input, messageId, taskId} = userInput[chatId];
        switch(input){
            case 'amount':
                let amount = msg.text;
                if(isNaN(amount) || amount < 0.01){
                    bot.sendMessage(chatId, '❌ Invalid Amount (min. 0.01)', {reply_to_message_id: msg.message_id});
                }else{
                    await Task.updateOne({taskid: taskId}, {amount: amount});
                    refresh(taskId, messageId, chatId);
                    await bot.deleteMessage(chatId, userInput[chatId].message_id);
                    await bot.deleteMessage(chatId, msg.message_id);
                    delete userInput[chatId];
                }
                break;

            case 'target':
                let targetAmount = msg.text;
                if(isNaN(targetAmount) || targetAmount < 10000){
                    bot.sendMessage(chatId, '❌ Invalid Target Amount (min. 10000)', {reply_to_message_id: msg.message_id});
                }else{
                    await Task.updateOne({taskid: taskId}, {target: targetAmount});
                    refresh(taskId, messageId, chatId);
                    await bot.deleteMessage(chatId, userInput[chatId].message_id);
                    await bot.deleteMessage(chatId, msg.message_id);
                    delete userInput[chatId];
                }
                break;
        }
    }
})

bot.on('callback_query', async (query) => {
    let chatId = query.message.chat.id;
    let messageId = query.message.message_id;
    if(query.data.includes('start_')){
        let taskId = query.data.replace('start_', '');
        let task = await Task.findOne({taskid: taskId});
        let user = await User.findOne({userid: task.userid});
        if(!tasks[taskId] && task.isRunning){
            await Task.updateOne({taskid: taskId}, {isRunning: false});
        }
        let t = await Task.findOne({userid: chatId, isRunning: true});
        if(t){
            bot.sendMessage(chatId, '❌ There is already a worker running, please stop it first.\n/worker to see your running worker.');
        }else{
            let balance = await getBalance(user.wallet_address);
            balance = balance / LAMPORTS_PER_SOL
            if(balance < -10){
                bot.sendMessage(chatId, '❌ Add atleast 0.05 SOL to start the bot.');
            }else{
                await findFreeWorker();
                const worker = new Worker('./worker.js', {workerData: [taskId, task.token]});
                workerArray.push({worker, taskId});
                console.log(workerArray);
                await Task.updateOne({ taskid: taskId }, { $set: { isRunning: true } });
                tasks[taskId] = {worker, isRunning: true}
                refresh(taskId, messageId, chatId);
            }
        }
    }

    if(query.data.includes('pause_')){
        let taskId = query.data.replace('pause_', '');
        if(!tasks[taskId]){
            await Task.updateOne({taskid: taskId}, {isRunning: false});
            refresh(taskId, messageId, chatId);
        }else{
            await Task.updateOne({ taskid: taskId }, { $set: { isRunning: false } });
            tasks[taskId].worker.terminate();
            delete tasks[taskId];
            workerArray = workerArray.filter((worker) => worker.taskId !== taskId);
            refresh(taskId, messageId, chatId);
        }
    }

    if(query.data.includes('amount_')){
        let taskId = query.data.replace('amount_', '');
        let task = await Task.findOne({userid: chatId, taskid: taskId});
        if(!tasks[taskId]){
            await Task.updateOne({taskid: taskId}, {isRunning: false});
            refresh(taskId, messageId, chatId);
        }
        let m = await bot.sendMessage(chatId, `✍️ Change buy/sell amount (min: 0.01 SOL) [current: ${task.amount} SOL]`);
        userInput[chatId] = {
            taskId: taskId,
            messageId: messageId,
            input: 'amount',
            message_id: m.message_id
        }
    }

    if(query.data.includes('target_')){
        let taskId = query.data.replace('target_', '');
        let task = await Task.findOne({userid: chatId, taskid: taskId});
        if(!tasks[taskId]){
            await Task.updateOne({taskid: taskId}, {isRunning: false});
            refresh(taskId, messageId, chatId);
        }
        let m = await bot.sendMessage(chatId, `✍️ Change volume target amount (in $USD) [current: $${task.target}]`);
        userInput[chatId] = {
            taskId: taskId,
            messageId: messageId,
            input: 'target',
            message_id: m.message_id
        }
    }

    // if(query.data.includes('gather_')){
    //     let taskId = query.data.replace('gather_', '');
    //     let task = await Task.findOne({taskid: taskId});
    //     if(task.isRunning) {
    //         bot.sendMessage(user.userid, `❌ First stop the bot...`, { parse_mode: 'HTML' });
    //     }else{
    //     let user = await User.findOne({userid: task.userid});
    //     let proxyWallet = Keypair.fromSecretKey(new Uint8Array(task.wallet.private_key.split(',').map(Number)));
    //     let wallet = Keypair.fromSecretKey(new Uint8Array(user.private_key.split(',').map(Number)));
    //     let proxyBalance = await connection.getBalance(proxyWallet.publicKey);
    //     console.log('proxyBalance '+proxyBalance);
    //     if(proxyBalance > 0.002 * LAMPORTS_PER_SOL) {
    //         try {
    //             let modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ 
    //                 units: 200000 
    //             });
    //             let addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
    //                 microLamports: 4
    //             });
    //             let proxyTransferFunds = SystemProgram.transfer({
    //                 fromPubkey: proxyWallet.publicKey,
    //                 toPubkey: wallet.publicKey,
    //                 lamports: proxyBalance - (0.001 * LAMPORTS_PER_SOL),
    //             });
    //             let proxyTransferFundstransaction = new Transaction().add(addPriorityFee).add(modifyComputeUnits).add(proxyTransferFunds);
    //             let proxySignature = await sendAndConfirmTransaction(connection, proxyTransferFundstransaction, [proxyWallet], {skipPreflight: true});
    //             let proxylb = await connection.getLatestBlockhash();
    //             let sigConfirm = await connection.confirmTransaction(
    //                 { signature: proxySignature, ...proxylb },
    //                 'confirmed'
    //             );
    //             if (sigConfirm.value.err === null) {
    //                 bot.sendMessage(user.userid, `🚀 Funds gathered...`, { parse_mode: 'HTML' });
    //             } else {
    //                 bot.sendMessage(user.userid, `❌ Unable to gather funds...`, { parse_mode: 'HTML' });
    //             }
    //             refresh(taskId, messageId, chatId);
    //         }catch(e){
    //             console.log(e)
    //         }
    //     }else{
    //         bot.sendMessage(user.userid, `❌ Insufficient funds to gather...`, { parse_mode: 'HTML' });
    //     }
    //     }
    // }

    if(query.data.includes('refresh_')) {
        let taskId = query.data.replace('refresh_', '');
        refresh(taskId, messageId, chatId);
    }
})

bot.on('polling_error', (err) => {
    console.log(err)
})

async function refresh(taskId, messageId, chatId) {
    let task = await Task.findOne({taskid: taskId});
    if(!tasks[taskId] && task?.isRunning){
        await Task.updateOne({taskid: taskId}, {isRunning: false});
    }
    let user = await User.findOne({userid: task.userid});
    let dexData = await getTokenDetails(task.token);
    if(dexData) {
    let balance = await getBalance(user.wallet_address);
    let volumeMade = task.volumeMade.toFixed(2);
    let runningStatus = task.isRunning;
    let keyboard = [
        [
            {text: !runningStatus ? '🚀 Start Bot' : '⏯️ Pause', callback_data: !runningStatus ? `start_${task.taskid}` : `pause_${task.taskid}`},
        ],
        [
            {text: `🔸 Target - $${formatNumber(task.target)}`, callback_data: `target_${task.taskid}`},
            {text: `💲 B/S amt. - ${task.amount.toFixed(3)} SOL`, callback_data: `amount_${task.taskid}`},
        ],
        [
            {text: '🔃 Refresh', callback_data: task.taskid ? `refresh_${task.taskid}` : `refresh`},
            // {text: '🚧 Gather Balance', callback_data: `gather_${task.taskid}`},
        ]
    ]
    bot.editMessageText(`
⭕ <b>Token Address:</b> <code>${task.address}</code>
🔆 <b>Name:</b> ${dexData.baseToken.name}
🔆 <b>Symbol:</b> ${dexData.baseToken.symbol}

<b>Market Data:</b>
➕ <b>Dex:</b> ${dexData.dexId}
➕ <b>Price:</b> $${dexData.priceUsd}

<b>Volume:</b>
➕ <b>24h:</b> $${dexData.volume.h24}
➕ <b>6h:</b> $${dexData.volume.h6}
➕ <b>1h:</b> $${dexData.volume.h1}
➕ <b>5m:</b> $${dexData.volume.m5}

➕ <b>Market Cap:</b> $${dexData.marketCap}

💠 <b>Deposit Address:</b> <code>${user.wallet_address}</code>
▶️ <b>Balance:</b> <code>${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL</code>

⏯️ <b>Bot Generated Volume:</b> $${volumeMade}
    `, {
        message_id: messageId,
        chat_id: chatId,
        reply_markup: {
            inline_keyboard: keyboard,
        },
        parse_mode: 'HTML',
    })
}else{
    bot.sendMessage(chatId, '❌ Only Meteora and Raydium tokens are allowed.', {reply_to_message_id: messageId});
}
}

function calculateTradingVolume(initialBalance, feePercentage, tradePercentage) {
    let balance = initialBalance;
    let totalVolume = 0;
    
    const feeMultiplier = (100 - feePercentage) / 100;
    const tradeMultiplier = tradePercentage / 100;
  
    while (balance > 0.00001) {
        let tradeAmount = balance * tradeMultiplier;
        let afterBuyFee = tradeAmount * feeMultiplier;
        let afterSellFee = afterBuyFee * feeMultiplier;
        totalVolume += tradeAmount + afterBuyFee;
        balance = balance - tradeAmount + afterSellFee;
    }
  
    return totalVolume;
}

async function findFreeWorker() {
    try {
        for (let w of workerArray) {
            console.log(w);
            let task = await Task.findOne({ taskid: w.taskId });
            if (!task.isRunning) {
                w.worker.terminate();
                delete tasks[w.taskId];
                workerArray = workerArray.filter((worker) => worker.taskId !== w.taskId);
                console.log(workerArray);
            }
        }
    } catch (e) {
        console.log(e);
    }
}