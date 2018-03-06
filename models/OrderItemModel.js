//Import the mongoose module
var mongoose = require('mongoose');
require('mongoose-long')(mongoose);


//Define a schema
var Schema = mongoose.Schema;
var SchemaTypes = mongoose.Schema.Types;

var OrderItemModelSchema = new Schema({
    bill_no: Number,
    quantity: Number,
    original_quantity: Number,
    id: Number,
    name: String,
    mrp: Number,
    barcode: String,
    is_set_on_HQ: Boolean,
    order_id: Number,
    time: String,
    dispense_status: String,
    outlet_order_id: SchemaTypes.Long,
    count: Number,
    dispensing_count: Number,
    delivered_count: Number,
    dispense_status_scanded_ids: String,
    delivered_status_scanded_ids: String,
});


// Compile model from schema
OrderItemModel = mongoose.model('order_item_details', OrderItemModelSchema);



// make this available to our users in our Node applications
module.exports = OrderItemModel;