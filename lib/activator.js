/*jslint node:true, nomen:true */
/*global escape */

// with defaults
var async = require('async');
var smtp = require('./mailer');
var _ = require('lodash-node');
var uuid = require('node-uuid');
var Errors = require('node-common-errors');
var DEFAULTS = require('./config.js');


// few helpers
var DEFAULT_RESPONSE = { ok: true };
var INITIALIZED = false;

// Cached variables
var mailer, templates, emailProperty, idProperty, resetExpire,
    password_reset_subject, activation_subject, model, validatedProperty;

/**
 * Get property by any means we can
 * @param {Object} req          - http request object
 * @param {Object} propertyName - property to get
 */
function getProperty(req, propertyName) {
  return req.activator && req.activator[propertyName] ||
    req.query[propertyName] || req.body[propertyName] || req.params[propertyName];
}

/**
 * CreateActivate:
 * 	- creates activation link for a user and sends an email
 * @param {Object}   req  - express.js request option
 * @param {Function} done - callback <err, statusCode, responseBody>
 */
function createActivate(req, done) {
  if (!INITIALIZED) {
    return done(new Errors.Uninitialized());
  }

  // add the activation code, just a randomization of this very moment, plus the email, hashed together
  var id = getProperty(req, idProperty);
  if (!id) {
    return done(new Errors.BadRequest('id not specified'));
  }

  var email, code;

  async.waterfall([

    function retrieveUser(callback) {
      var query = {};
      query[idProperty] = id;
      model.find(query, callback);
    },

    function checkThrottle(user, callback) {
      if (!model.throttle) {
        return callback(null, user);
      }

      if (!user) {
        return callback(new Errors.NotFound());
      }

      model.throttle(user, 'activate', callback);
    },

    function processUser(user, callback) {
      if (!user) {
        return callback(new Errors.NotFound());
      }

      email = user[emailProperty];
      code = uuid.v4();

      model.save(id, { $set: { activation_code: code } }, callback);
    },

    function sendEmail(user, callback) {
      if (!callback && typeof (user) === "function") {
        callback = user;
      }

      mailer('activate', 'en_US', {
        code: code,
        email: email,
        id: id,
        request: req
      }, email, activation_subject, callback);
    }

  ], function createActivationPipeComplete(err) {
    if (err) {
      return done(err);
    }

    var message = req.activator && req.activator.body ? req.activator.body : DEFAULT_RESPONSE;
    done(null, 201, message);
  });
}

/**
 * Completes user's account activation
 * @param {Object}   req  - expressjs request object
 * @param {Function} done - <err, statusCode, responseBody>
 */
function completeActivate(req, done) {
  if (!INITIALIZED) {
    return done(new Errors.Uninitialized());
  }

  var code = getProperty(req, 'code'),
      id = getProperty(req, idProperty);

  if (!code || !id) {
    return done(new Errors.BadRequest('code or id not specified'));
  }

  async.waterfall([

    function retrieveUser(callback) {
      var query = {};
      query[idProperty] = id;
      model.find(query, callback);
    },

    function processUser(user, callback) {
      if (!user) {
        return callback(new Errors.NotFound());
      }

      if (user.activation_code !== code) {
        return callback(new Errors.Forbidden());
      }

      // mark account as validated
      var $set = {};
      $set[validatedProperty] = true;

      model.save(id, { $unset: { activation_code: '' }, $set: $set }, callback);
    }

  ], function activationCompleted(err) {
    if (err) {
      return done(err);
    }

    done(null, 200, DEFAULT_RESPONSE);
  });
}

/**
 * Processes password reset request
 * @param {Object}   req  - expressjs object
 * @param {Function} done - <err, statusCode, responseBody>
 */
function createPasswordReset(req, done) {
  if (!INITIALIZED) {
    return done(new Errors.Uninitialized());
  }

  var email = getProperty(req, emailProperty);
  if (!email) {
    return done(new Errors.BadRequest('email not specified'));
  }

  var id, reset_time, reset_code;

  /*
   * process:
   * 1) get the user by email
   * 2) create a random reset code
   * 3) save it
   * 4) send an email
   */
  async.waterfall([

    function retrieveUser(callback) {
      var query = {};
      query[emailProperty] = email;
      model.find(query, callback);
    },

    function checkThrottle(user, callback) {
      if (!model.throttle) {
        return callback(null, user);
      }

      if (!user) {
        return callback(new Errors.NotFound());
      }

      model.throttle(user, 'password', callback);
    },

    function processUser(user, callback) {
      if (!user) {
        return callback(new Errors.NotFound());
      }

      id = user[idProperty];
      reset_time = Date.now() + resetExpire * 60 * 1000;
      reset_code = uuid.v4();

      // expires in 60 minutes
      // save the update
      model.save(id, { $set: { password_reset_code: reset_code, password_reset_time: reset_time } }, callback);
    },

    function sendResetCodeToTheUser(user, callback) {
      if (!callback && typeof user === "function") {
        callback = user;
      }

      mailer("passwordreset", "en_US", {
        code: reset_code,
        email: email,
        id: id,
        request: req
      }, email, password_reset_subject, callback);
    }

  ], function createPasswordResetProcessed(err) {
      if (err) {
        return done(err);
      }

      return done(null, 201, DEFAULT_RESPONSE);
  });
}

/**
 * Confirms password reset and sets new password
 * @param {Object}   req  - expressjs object
 * @param {Function} done - <err, statusCode, responseBody>
 */
function completePasswordReset(req, done) {
  if (!INITIALIZED) {
    return done(new Errors.Uninitialized());
  }

  var reset_code = getProperty(req, 'code'),
      password = getProperty(req, 'password'),
      id = getProperty(req, idProperty),
      now = Date.now();

  if (!password) {
    return done(new Errors.BadRequest('Missing Password'));
  }

  if (!id) {
    return done(new Errors.BadRequest('Missing User Id'));
  }

  if (!reset_code) {
    return done(new Errors.BadRequest('Missing Reset Code'));
  }

  async.waterfall([

    function retrieveUser(callback) {
      var query = {};
      query[idProperty] = id;
      model.find(query, callback);
    },

    function processUser(user, callback) {
      if (!user) {
        return callback(new Errors.NotFound());
      }

      if (user.password_reset_code !== reset_code) {
        return callback(new Errors.BadRequest('Invalid Reset Code'));
      }

      if (user.password_reset_time < now) {
        return callback(new Errors.BadRequest('Expired Reset Code'));
      }

      model.save(user[idProperty], {
        $set: { password: password },
        $unset: { password_reset_code: '', password_reset_time: '' }
      }, callback);
    }

  ], function passwordResetCompleted(err) {
      if (err) {
        return done(err);
      }

      return done(null, 200, DEFAULT_RESPONSE);
  });
};


/**
 * Creates function with <err, code, message> signature for handling responses
 * from our functions, using `next` callback
 *
 * @param {Object}   req  - http request
 * @param {Function} next - callback
 */
var createNextHandler = function (req, next) {
  return function (err, code, message) {
    if (err) {
      return next(err);
    }

    req.activator = req.activator || {};
    _.extend(req.activator, { code: code, message: message });
    setImmediate(next);
  };
};

/**
 * Creates function with <err, code, message> signature for handling responses
 * from our functions
 *
 * @param {Object}   req  - http request
 */
var createResponse = function (res) {
  return function (err, code, message) {
    if (err) {
      return res.status(err.code || 500).send(err.message || 'Internal Server Error');
    }

    res.status(code).send(message);
  }
};

/**
 * Public API
 * @type {Object}
 */
module.exports = {

  /**
   * Initializes activator module
   * @param  {Object} config
   * - contains following properties:
   * 	 * `user` {Object}:
   * 	   1. `find` {Function}  <userId, callback>
   * 	   2. `save` {Function}  <userId, dataToSave, callback>
   *
   * 	 * `templates` {String} - directory for templates used by `smtp`
   *
   * 	 * `resetExpire` {Number} - duration of expiration link validity, default: 60
   *
   * 	 * `smtp`: {Function|Object} - function which accepts `type`, `lang`, `data`, `to`, `subject`, `callback`
   * 	 		and `callback` params and sends emails based on them, defaults: built-in mail composer
   *
   * 	 * `from`: {String|Object|Null} - to be used in `nodemailer`'s `from` field
   *
   * 	 * `emailProperty`: {String} - defaults to `email`
   *
   * 	 * `idProperty`: {String} - defaults to `_id`
   *
   * 	 * `createNextHandler`: {Function}
   *
   * 	 * `createResponse`: {Function}
   *
   * 	 * `transport`: {Function} - set this if you want to use preconfigured transport
   * 	 setup these for generating links in the email templates
   *
   * 	 * `protocol`: {String} - defaults to 'http://'
   *
   *   * `domain`: {String} - defaults to 'localhost'
   *
   *   * `pathActivate`: {String} - defaults to '/api/1/users/activate'
   *
   *   * `pathResetPassword`: {String} - defaults to '/api/1/users/forgot'
   *
   *   * `password_reset_subject`: {String} - subject for password reset emails
   *
   * 	 * `activation_subject`: {String} - subject for account activation emails
   *
   *   * `validatedProperty`: {String} - property that will be set to true
   */
  init: function(config) {
    INITIALIZED = true;

    _.defaults(config, DEFAULTS);

    // extract
    model = config.user;
    templates = config.templates;
    resetExpire = config.resetExpire;
    password_reset_subject = config.password_reset_subject;
    activation_subject = config.activation_subject;
    emailProperty = config.emailProperty;
    idProperty = config.idProperty;
    validatedProperty = config.validatedProperty;

    // setup mailer
    if (typeof config.smtp === 'function') {
      mailer = config.smtp;
    } else {
      mailer = smtp(config, templates);
    }

    // response handler functions
    createNextHandler = config.createNextHandler || createNextHandler;
    createResponse = config.createResponse || createResponse;
  },

  /**
   * Middleware for creating password reset emails
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  createPasswordReset: function (req, res, next) {
    createPasswordReset(req, createResponse(res));
  },

  /**
   * Middleware for creating password reset function with passing control to
   * `next` handler
   *
   * Sets or extends `req.activator` with `code` and `message`
   *
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  createPasswordResetNext: function (req, res, next) {
    createPasswordReset(req, createNextHandler(req, next));
  },

  /**
   * Middleware for completing password reset
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  completePasswordReset: function (req, res, next) {
    completePasswordReset(req, createResponse(res));
  },

  /**
   * Middleware for completing password reset passing control to next handler
   *
   * Sets or extends `req.activator` with `code` and `message`
   *
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  completePasswordResetNext: function (req, res, next) {
    completePasswordReset(req, createNextHandler(req, next));
  },

  /**
   * Middleware for creating account activation request
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  createActivate: function (req, res, next) {
    createActivate(req, createResponse(res));
  },

  /**
  * Middleware for creating account activation request and passing control to
  * next handler
  *
  * Sets or extends `req.activator` with `code` and `message`
  *
  * @param {Object}   req  - express.js request
  * @param {Object}   res  - express.js response
  * @param {Function} next - <err>
  */
  createActivateNext: function (req, res, next) {
    createActivate(req, createNextHandler(req, next));
  },

  /**
   * Middleware for completing activation
   * @param {Object}   req  - express.js request
   * @param {Object}   res  - express.js response
   * @param {Function} next - <err>
   */
  completeActivate: function (req, res, next) {
    completeActivate(req, createResponse(res));
  },

  /**
  * Middleware for completing activation, passing control to next handler
  *
  * Sets or extends `req.activator` with `code` and `message`
  *
  * @param {Object}   req  - express.js request
  * @param {Object}   res  - express.js response
  * @param {Function} next - <err>
  */
  completeActivateNext: function (req, res, next) {
    completeActivate(req, createNextHandler(req, next));
  }

};
