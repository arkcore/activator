# Express.JS User Activator

## Usage

```js
var _ = require('lodash-node');
var express = require('express'),
    bodyParser = require('body-parser'),
    app = express();

// lets assume that your model is here
// Make sure to specify following fields if you use mongoose:
//
// password_reset_code: String
// password_reset_time: Number
// activation_code: String
// password: String
// validated: Boolean
//
// Obviously password hashing is not handled here, either pre-process it yourself,
// or use mongoose middleware
//
var User = require('./models/user');

var activator = require('express-user-activator');
var config = {
  user: {},
  protocol: 'http://',
  domain: 'localhost',
  // this will be used to craft email activation links
  pathActivate: '/api/1/users/activate',
  // this will be used to craft password reset confirmation links
  pathResetPassword: '/api/1/users/forgot'
};

// method to find user
config.user.find = function (searchQuery, callback) {
  // it should return user in the callback, signature is <err, user>
  User.findOne(searchQuery, callback);
};

// method to update user
// this is used to save data into user,
// it's your responsibility to setup protection here
config.user.save = function (id, data, callback) {
  // data contains $set and $del properties, we need to perform actions based
  // on these properties
  // Lets assume we use mongodb, then the example would be as simple as this:
  // You might want to take care of error handling though, since here we just
  // spit them out
  User.update({ _id: id }, data, callback);
};

// make sure to initialize it
activator.init(config);


// handling activation
var activateRoutes = express.Router(config.pathActivate)
  .get(activator.createActivate)
  .post(activator.completeActivate);

// handling password reset
var passwordResetRoutes = express.Router(config.pathResetPassword)
  .get(activator.createPasswordReset)
  .post(activator.completePasswordReset);


app.use(bodyParser);
app.use(activateRoutes);
app.use(passwordResetRoutes);

```

## Configuration

Everything in the code is pretty much commented, but here is a little helper
to get you started quicker

* `user` {Object}: ***must override***
  1. `find` {Function}  `<userId, callback>` signature
  2. `save` {Function}  `<userId, dataToSave, callback>` signature
* `user` {Object}: ***can override***
  1. `throttle` {Function}  `<userModel, type, callback>` signature

***Note***  
User must have these fields available: `password_reset_code`, `password_reset_time`,
`activation_code`, `password`  

* `templates` {String} - directory for templates used by `smtp`
* `resetExpire` {Number} - duration of expiration link validity, default: 60
* `smtp`: {Function|Object} - function which accepts `type`, `lang`, `data`, `to`, `subject`, `callback`
  and `callback` params and sends emails based on them, defaults: built-in mail composer
* `from`: {String|Object|Null} - to be used in `nodemailer`'s `from` field ***must override***
* `emailProperty`: {String} - defaults to `email`
* `idProperty`: {String} - defaults to `_id`
* `createNextHandler`: {Function}
* `createResponse`: {Function}
* `transport`: {Function} - set this if you want to use preconfigured transport
 setup these for generating links in the email templates
* `protocol`: {String} - defaults to `http://`
* `domain`: {String} - defaults to `localhost`, ***must override***
* `pathActivate`: {String} - defaults to `/api/1/users/activate`
* `pathResetPassword`: {String} - defaults to `/api/1/users/forgot`
* `password_reset_subject`: {String} - subject for password reset emails
* `activation_subject`: {String} - subject for account activation emails
* `validatedProperty`: {String} - use this to mark account as validated


## Testing
To run the tests, from the root directory, run `npm test`.

## License
Released under the MIT License.

Originally developed by [Avi Deitcher](https://github.com/deitch)

Rewritten by [Vitaly Aminev](https://github.com/AVVS)
