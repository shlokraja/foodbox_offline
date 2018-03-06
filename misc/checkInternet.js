var async = require('async');
var Q = require('q');


function mainCheckInternet() {
    // console.log('##############################');
    // console.log('in the function');
    // console.log('##############################');
    // checkInternet().then(function(data) {
    //    console.log('##############################');
    //    console.log('data',data);
    //    console.log('##############################');
    //    return data;
    // })
    // var r = yield wait.for( myApi.exec, 'SomeCommand');
    // return r;
    value = true;



}

function checkInternet() {
    return new Promise(
        function(resolve, reject) {
            require('dns').resolve('www.google.com', function(err) {
                if (err) {
                    console.log("No connection");
                    resolve("false");
                } else {
                    console.log("Connected");
                    resolve("true");
                }
            });
        }

    );
}

module.exports = mainCheckInternet;