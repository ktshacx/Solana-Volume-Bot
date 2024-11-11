const API = "https://api.dexscreener.com/latest/dex/search?q=";

async function getTokenDetails(address) {
    let data = await fetch(API + address);
    let tokenPairs = await data.json();
    console.log(tokenPairs)

    if (tokenPairs.pairs && tokenPairs.pairs.length > 0) {
        return tokenPairs.pairs[0];
    }

    return null;
}

module.exports = { getTokenDetails };