const mongoose = require('mongoose');

let taskSchema = new mongoose.Schema({
    taskid: {type: String},
    userid: {type: String},
    address: {type: String},
    isRunning: {type: Boolean},
    volumeMade: {type: Number},
    token: {type: String},
    amount: {type: Number},
    target: {type: Number},
    wallets: {type: Array}
})

const Task = mongoose.model('Task', taskSchema);
module.exports = Task;