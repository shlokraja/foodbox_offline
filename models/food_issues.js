//Import the mongoose module
var mongoose = require('mongoose');

//Define a schema
var Schema = mongoose.Schema;

var FoodIssueModelSchema = new Schema({
    barcode: String,
    final_status: String,
    problem: String,
    note: String,
    inserttime: String,
    count: Number,
    is_set_on_HQ: Boolean,
    name: String
});


// Compile model from schema
FoodIssueModel = mongoose.model('food_issue', FoodIssueModelSchema);



// make this available to our users in our Node applications
module.exports = FoodIssueModel;