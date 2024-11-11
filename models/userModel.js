const mongoose = require('mongoose');

let userSchema = new mongoose.Schema({
    userid: {type: String, required: true},
    wallet_address: {type: String, required: true},
    private_key: {type: String, required: true},
})

const User = mongoose.model('User', userSchema);
module.exports = User;