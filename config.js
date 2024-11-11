const { Connection } = require("@solana/web3.js");
const mongoose = require('mongoose');
require('dotenv').config();

const config = {
    // rpc: 'https://mainnet.helius-rpc.com/?api-key=6ade3723-07c0-4936-a748-a73d1d36ffae',
    // rpc: 'https://go.getblock.io/c9837f30112a402c9883fd95616b3785',
    // rpc: 'https://solana-mainnet.core.chainstack.com/105286c92d78bd3cbcef3a30cb2f6d81',
    // rpc: 'https://rpc-mainnet.solanatracker.io/?api_key=e56944a9-9557-4e90-96bc-3d9190fe2003',
    rpc: 'https://api.mainnet-beta.solana.com',
    tax_wallet: 'H4mu49XfHpvpMzuGWuKWGgDi6frS44TubxFbwmefy1ed',
    poolTax: 1, // 5%
    botTax: 0.001, // .01%
    walletLimit: 4
}

const connection = new Connection(config.rpc, 'confirmed');

// MongoDB connection using Mongoose
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
    }
}

module.exports = {connection, config, connectDB};