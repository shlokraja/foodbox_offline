function checkEOD() {
    // only check for eod if the outlet is non 24 hrs
    if (!is24hr) 
    {
        var current_time = new Date();
        var time_in_mins = current_time.getHours() * 60 + current_time.getMinutes();
        if ((time_in_mins == eod_time) && !start_of_day) 
	{
            showEODDialog();
        }
    }
}


function showEODDialog() 
{
    // iterate the supply list, populate the eod dialog
    // and then show it
    var tableDiv = $("#eod-dialog .modal-body table tbody");
    $(tableDiv).empty();
    for (var i = 0; i < supply_list.length; i++) 
    {
        $(tableDiv).append('<tr data-item_id="' + supply_list[i].id + '"><td><img src="' + supply_list[i].image_url + '" height="30">' + supply_list[i].name + '</td><td><input type="text" class="supply_qty" /></td></tr>');
    }
    $("#eod-dialog").modal({ show: true, backdrop: "static" });
    from_eod = true;

    $.ajax({
        type: 'POST',
        url: OUTLET_URL + '/outlet_app/expire_all_items',
        success: function(data) {
            console.log(data);
        },
        error: function(jqxhr, textStatus, error) {
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Expiring items failed: " + err_msg);
        },
        contentType: "application/json",
        dataType: 'text'
    });
}



// change function to make the system work offline with speed

function getSupplyItems() {
    check_internet = checkinternet();
    if (check_internet == "true") {
        $.getJSON(HQ_URL + '/outlet/supply_list/' + OUTLET_ID)
            .done(function(data) 
	    {
                console.log('Received supply list data' + JSON.stringify(data));
                supply_list = data;
                sotoresuppliesdetails(supply_list);
                // check for start of day after this
                checkStartOfDay();
            })
            .fail(function(jqxhr, textStatus, error) 
	    {
                var err_msg = textStatus + ", " + jqxhr.responseText;
                console.error("Request Failed: " + err_msg);
                supply_list = getSupplyItemsFromLocal();
                checkStartOfDay();
            });
    } else {
        supply_list = getSupplyItemsFromLocal();
        checkStartOfDay();
    }

}

function getSalesData()
 {
    // setting the month
    $("#sales_cash .month .month_text").text(n_month);
    // getting the sales and cash data
    $.getJSON(OUTLET_URL + '/outlet_app/get_sales_info/')
        .done(function(data) {
            console.log('Received sales and cash data- ' + JSON.stringify(data));
            var amount_sold_cash = parseInt(data["amount_sold_cash"]["sum"]);
            var amount_sold_pettycash = parseInt(data["amount_sold_pettycash"]["sum"]);
            $("#sales_cash .panel_header .cash_value").html("<img src=\"img/icons/Rupee.png\" />" + (amount_sold_cash - amount_sold_pettycash));
            var num_items_sold_dispenser = data["num_items_sold_dispenser"];
            var num_items_sold_outside = data["num_items_sold_outside"];
            var num_items_sold = [num_items_sold_dispenser, num_items_sold_outside];
            if (typeof num_items_sold != "undefined") {
                for (var i = 0; i < num_items_sold.length; i++) {
                    if (typeof num_items_sold[i] != "undefined") {
                        switch (num_items_sold[i]["location"]) {
                            case "dispenser":
                                $("#sales_cash .nos .food .num").text(num_items_sold[i]["count"]);
                                break;
                            case "outside":
                                $("#sales_cash .nos .others .num").text(num_items_sold[i]["count"]);
                                break;
                            default:
                                break;
                        }
                    }
                }
            }

            //var amount_sold_month_dispenser = data["amount_sold_month_dispenser"];
            //var amount_sold_month_outside = data["amount_sold_month_outside"];
            //var amount_sold_month = [amount_sold_month_dispenser, amount_sold_month_outside];
            //for (var i = 0; i < amount_sold_month.length; i++)
            //{
            //    var unit = '';
            //    amount_sold_month[i]["sum"] = parseInt(amount_sold_month[i]["sum"]);
            //    if (amount_sold_month[i]["sum"] >= 100000)
            //    {
            //        amount_sold_month[i]["sum"] = amount_sold_month[i]["sum"] / 100000;
            //        unit = 'L';
            //    } else if (amount_sold_month[i]["sum"] >= 1000)
            //    {
            //        amount_sold_month[i]["sum"] = amount_sold_month[i]["sum"] / 1000;
            //        unit = 'K';
            //    }
            //    switch (amount_sold_month[i]["location"])
            //    {
            //        case "dispenser":
            //            $("#sales_cash .month .food .num").html('<img src="img/icons/Rupee.png" />' + amount_sold_month[i]["sum"].toFixed(2) + ' ' + unit);
            //            break;
            //        case "outside":
            //            $("#sales_cash .month .others .num").html('<img src="img/icons/Rupee.png" />' + amount_sold_month[i]["sum"].toFixed(2) + ' ' + unit);
            //            break;
            //        default:
            //            break;
            //    }
            //}

            //// Displaying cash sales for a day
            //var amount_sold_day_dispenser = data["amount_sold_day_dispenser"];
            //var amount_sold_day_outside = data["amount_sold_day_outside"];
            //var amount_sold_day = [amount_sold_day_dispenser, amount_sold_day_outside];
            //for (var i = 0; i < amount_sold_day.length; i++)
            //{
            //    var unit = '';
            //    amount_sold_day[i]["sum"] = parseInt(amount_sold_day[i]["sum"]);
            //    if (amount_sold_day[i]["sum"] >= 100000)
            //    {
            //        amount_sold_day[i]["sum"] = amount_sold_day[i]["sum"] / 100000;
            //        unit = 'L';
            //    } else if (amount_sold_day[i]["sum"] >= 1000)
            //    {
            //        amount_sold_day[i]["sum"] = amount_sold_day[i]["sum"] / 1000;
            //        unit = 'K';
            //    }
            //    switch (amount_sold_day[i]["location"])
            //    {
            //        case "dispenser":
            //            $("#sales_cash .day .food .num").html('<img src="img/icons/Rupee.png" />' + amount_sold_day[i]["sum"].toFixed(2) + ' ' + unit);
            //            break;
            //        case "outside":
            //            $("#sales_cash .day .others .num").html('<img src="img/icons/Rupee.png" />' + amount_sold_day[i]["sum"].toFixed(2) + ' ' + unit);
            //            break;
            //        default:
            //            break;
            //    }
            //}

        })
        .fail(function(jqxhr, textStatus, error) 
	{
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Request for getting sales data failed: " + err_msg);
        });

    $.getJSON(OUTLET_URL + '/outlet_app/get_sales_info_cashcard/')
        .done(function(data) 
	{
            $("#sales_cash_table").html('<div id="sales_cash_table">\
            <div class="table-responsive">\
                <table border="1" class="table table-hover sales-cash-table"> \
                <tbody><tr> <th></th>\
                <th>Food count</th> \
                <th>Others</th> \
                <th>Cash</th> \
                <th>Card</th>\
                 <th>Sodexo Card</th>\
                 <th>Sodexo Coupon</th>\
                 <th>Credit</th>\
                 <th>GPRS Card</th>\
                 <th>Wallet</th><th>Total</th></tr> \
                 <tr><td class="sidemenu"> Today</td><td>' + data["dispenser_day_count"] + ' </td><td> ' + data["outside_day_count"] + '</td><td> ' + data["day_cash_amount"] + '</td><td> ' + data["day_card_amount"] + '</td><td> ' + data["day_sodexocard_amount"] + '</td><td> ' + data["day_sodexocoupon_amount"] + '</td><td> ' + data["day_credit_amount"] + '</td><td> ' + data["day_gprscard_amount"] + '</td><td> ' + data["day_wallet_amount"] + '</td><td> ' + data["day_total"] + '</td> </tr> <tr>  <td class="sidemenu"> Month</td><td> ' + data["dispenser_month_count"] + '</td><td> ' + data["outside_month_count"] + '</td><td> ' + data["month_cash_amount"] + '</td> <td> ' + data["month_card_amount"] + '</td><td> ' + data["month_sodexocard_amount"] + '</td><td> ' + data["month_sodexocoupon_amount"] + '</td><td> ' + data["month_credit_amount"] + '</td><td> ' + data["month_gprscard_amount"] + '</td><td> ' + data["month_wallet_amount"] + '</td><td> ' + data["month_total"] + '</td> </tr> </tbody></table></div>');
        })
        .fail(function(jqxhr, textStatus, error) 
	{
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Request for getting sales data failed: " + err_msg);
        });
}

// This function gets the staff roster from the LC
function getStaffRoster() 
{
    $.getJSON(OUTLET_URL + '/outlet_app/staff_roster/')
        .done(function(data) 
	{
            console.log('Received roster data' + JSON.stringify(data));
            var targetDiv = $("#staff-roster-dialog .modal-body");
            $(targetDiv).empty();
            for (var i = 0; i < data.length; i++) 
	    {
                // setting the checked attribute to true if the person is in shift
                var checked_flag = data[i].shift == 'shift_start' ? 'checked=""' : '';
                $(targetDiv).append('<div class="togglebutton"><label><span data-id="' + data[i].id + '" class="username ' + data[i].shift + '">' + data[i].username + '</span><input type="checkbox" ' + checked_flag + '></label></div>');
                staff_roster[data[i].id] = data[i].shift;
            }
        })
        .fail(function(jqxhr, textStatus, error) 
	{
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Request Failed: " + err_msg);
        });
}

function getBeverages() 
{
    //changes done for showing the breavegs from offline data
    //9 Aug 2017
    //$.getJSON(HQ_URL + '/food_item/price_info/' + OUTLET_ID)
    var jqxhr = $.getJSON(OUTLET_URL + '/order_app/getmenuitems')
        .done(function(data) 
	{
            console.log("populating beverage data");
            var targetDiv = $("#beverage-control-dialog .modal-body");
            $(targetDiv).empty();
            data.map(function(item) 
	    {
                // If the item is not beverage , return
                if (item.location != 'outside') 
		{
                    return;
                }

                var visibility = true;
                // check the previous status from simpleStorage
                if (simpleStorage.get(item["id"] + "_visibility") == false) 
		{
                    visibility = false;
                }

                beverage_data[item["id"]] = {
                    location: item["location"],
                    veg: item["veg"],
                    master_id: item["master_id"],
                    visible: visibility
                };
                var checked_flag = visibility ? 'checked=""' : '';
                // add it to the list
                $(targetDiv).append('<div class="togglebutton"><label><span data-id="' + item.id + '" class="beverage_item">' + item.name + '</span><input type="checkbox" ' + checked_flag + '></label></div>');
            });
        })
        .fail(function(jqxhr, textStatus, error) 
	{
            var err_msg = textStatus + ", " + error;
            console.error("Request Failed: " + err_msg);
        });
}

function updateBeverages() 
{
    // update the status in simpleStorage

    // create the list and send it to LC
}

// function getLivePOs() {

//     $.getJSON(OUTLET_URL + '/outlet_app/get_live_pos/')
//         .done(function(data) {
//             console.log('Received num of live pos' + JSON.stringify(data));
//             $("#purchase_orders .live .num").text(data.count);
//         })
//         .fail(function(jqxhr, textStatus, error) {
//             var err_msg = textStatus + ", " + jqxhr.responseText;
//             console.error("Request Failed: " + err_msg);
//         });
// }


function getLivePOs() {
    $.getJSON(OUTLET_URL + '/outlet_app/get_offline_pos/')
        .done(function(data) {
            console.log('Received num of live pos' + JSON.stringify(data));
            $("#purchase_orders .live .num").text(data.count);
        })
        .fail(function(jqxhr, textStatus, error) {
            var todays_count_length = 0;
            $.getJSON(OUTLET_URL + '/outlet_app/get_offline_pos/')
                .done(function(data) {
                    $("#purchase_orders .live .num").text(data);
                })
                .fail(function(jqxhr, textStatus, error) {
                    console.log('oops in error');
                    $("#purchase_orders .live .num").text(0);
                });

            /*end rajesh*/
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Request Failed: " + err_msg);
        });
}

function CheckTestMode() {
    $.getJSON(OUTLET_URL + '/order_app/test_mode/')
        .done(function(data) 
	{
            console.log('Received status of live pos' + JSON.stringify(data));
            var PreviousValue = $("#purchase_orders .panel_header .live .status").text();
            var status = "Live Mode"
            $("#purchase_orders .panel_header .live .status").css('color', 'Green');
            $("#purchase_orders .panel_header .live .status").text("Live Mode");
            if (data) 
	    {
                status = "Test Mode"
                $("#purchase_orders .panel_header .live .status").css('color', 'Red');
                $("#purchase_orders .panel_header .live .status").text("Test Mode");
            }
            if (PreviousValue != "") {
                if (PreviousValue != status) {
                    if (status == "Live Mode") {
                        simpleStorage.set("test_mode", false);
                    }
                    location.reload();
                }
            }
        })
        .fail(function(jqxhr, textStatus, error) 
	{
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Request Failed: " + err_msg);
        });
}

// This is the primary function that calls all other functions and
// gets things started

function StartDataBindings()
{
    // Initial set of calls
    CheckTestMode();
    getSalesData();
    getItemDetails();
    getStaffRoster();
    getLivePOs();
    getBeverages();
    getMobilePendingOrder();
    // Calls which are to be repeated
    setInterval(CheckTestMode, 5000);
    setInterval(getItemDetails, 300000);
    setInterval(getSalesData, 300000);
    setInterval(getLivePOs, 300000);
    // setInterval(checkEOD, 60000);
    setInterval(getMobilePendingOrder, 1000000);
    // This will run only once
    getSupplyItems();

    // Populate socket.io events. If there were events happening
    // in other pages, it reads off from local storage
    readSocketEvents();
}
function initDataBindings()
{
    $.ajax({
        type: 'get',
        url: OUTLET_URL + '/users/CheckLogin',
        success: function (data)
        {
            data = JSON.parse(data);
            if (data.userid == null || data.userid == 0)
            {
                $("#Login").modal({ show: true, backdrop: "static" });
            }
            else
            {
                simpleStorage.set("loggedinuserid", data.userid);
                $("#username").text(data.username);
                StartDataBindings();
            }
        },
        error: function (jqxhr, textStatus, error)
        {
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Check Login Failed" + err_msg);
        },
        contentType: "application/json",
        dataType: 'text'
    });
}
//Login
$('#btnLogin').click(function ()
{
    $('#overlay').show();
    var username = $('#user_name').val();
    var password = $('#password').val();
    if (username == "" || username == null)
    {
        $('#user_name_label').addClass('text-danger');
        $('#user_name_Help').text('User Name should not be Empty or greater than 3 characters');
        $('#user_name_Help').show();
        $('#overlay').hide();
        return;
    }
    if (password == "" || password == null || password.length <= 3)
    {
        $('#password_label').addClass('text-danger');
        $('#password_Help').text('Password should not be Empty or greater than 3 characters');
        $('#password_Help').show();
        $('#overlay').hide();
        return;
    }
    var obj = new Object();
    obj.user = username;
    obj.password = password;
    $.ajax({
        type: 'POST',
        url: OUTLET_URL + '/users/Login',
        contentType: "application/json",
        data: JSON.stringify({"user" : username , "password" : password}),
        success: function (data)
        {
            $("#Login").modal("hide");
            $('#overlay').hide();
            $.toaster({ priority: 'success', message: data });
            initDataBindings();
        },
        error: function (jqxhr, textStatus, error)
        {
            $('#overlay').hide();
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Check Login Failed" + err_msg);
            $.toaster({ priority: 'danger', message: err_msg.toString() });
        }
    });
});
$('#sales_details_yes').click(function ()
{
    $('#overlay').show();
    var remarks = $("#remarks").val();
    var desiredremarks = remarks.replace(/[^\w\s]/gi, '');
    var username = $("#username").text();
    var htmlcontent = $("#sales_details_content").html();
    $.ajax({
        type: 'POST',
        url: OUTLET_URL + '/users/Logout',
        contentType: "application/json",
        data: JSON.stringify({ "remarks": desiredremarks, "mailcontent": htmlcontent, "username": username }),
        success: function (data)
        {
            $("#sales-details-dialog").modal("hide");
            var isfromlogout = $('#btnlogout').data('logout');
            if (isfromlogout)
            {
                window.location.reload(true);
            }
            else
            {
                showEODDialog();
            }
            $('#btnlogout').data('logout', true);
            $("#remarks").val('');
            $('#overlay').hide();
        },
        error: function (jqxhr, textStatus, error)
        {
            $('#overlay').hide();
            var err_msg = textStatus + ", " + jqxhr.responseText;
            console.error("Check Login Failed" + err_msg);
            $.toaster({ priority: 'danger', message: err_msg.toString() });
        }
    });
});
$('#sales_details_no').click(function ()
{
    $('#btnlogout').data('logout', true);
    $("#sales-details-dialog").modal("hide");
});
