const { Keypair, PublicKey } = require("@solana/web3.js");
const { connection } = require("../config");

const genWallet = () => {
    let wallet = Keypair.generate();
    return wallet;
}

const getBalance = async (address) => {
    address = new PublicKey(address);
    let balance = await connection.getBalance(address);
    return balance;
}

const getPrice = (amount) => {
    return amount * 163.80;
}

function formatNumber(num) {
    if (Math.abs(num) >= 1.0e9) {
        return (num / 1.0e9).toFixed(1) + "B"; // Billion
    } else if (Math.abs(num) >= 1.0e6) {
        return (num / 1.0e6).toFixed(1) + "M"; // Million
    } else if (Math.abs(num) >= 1.0e3) {
        return (num / 1.0e3).toFixed(1) + "K"; // Thousand
    } else {
        return num.toString(); // Less than a thousand
    }
}

module.exports = {genWallet, getBalance, getPrice, formatNumber};