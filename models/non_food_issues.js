//Import the mongoose module
var mongoose = require('mongoose');

//Define a schema
var Schema = mongoose.Schema;

var NonFoodIssueModelSchema = new Schema({
        type: String,
        note: String,
        time:String,
        inserttime:String,
        reporter:String,
        is_set_on_HQ: Boolean
});


// Compile model from schema
NonFoodIssue = mongoose.model('non_food_issue', NonFoodIssueModelSchema);



// make this available to our users in our Node applications
module.exports = NonFoodIssue;